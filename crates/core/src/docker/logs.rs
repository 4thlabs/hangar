//! The logs of a container, followed line by line.

use std::collections::VecDeque;

use futures::{Stream, StreamExt, stream};
use quoll::ByteStream;

use super::engine::Containers as _;
use super::frames::{Demux, Output};
use super::{Docker, DockerError};

/// How many lines of the past a followed log starts with.
const TAIL: &str = "200";

/// The content type of the logs of a container with a TTY: its bytes as they are, in no frame.
const RAW_STREAM: &str = "application/vnd.docker.raw-stream";

/// What a failed read of a log says it was doing.
const FOLLOWING: &str = "follow a container's logs";

/// Cuts the bytes of a log into lines. Each output keeps its own unfinished line, so that a line of stderr written
/// between two halves of one of stdout splits neither.
#[derive(Debug, Default)]
struct LogLines {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl LogLines {
    /// The lines that `bytes`, written to `output`, finish.
    fn push(&mut self, output: Output, bytes: &[u8]) -> Vec<String> {
        let pending = match output {
            Output::Stdout => &mut self.stdout,
            Output::Stderr => &mut self.stderr,
        };

        pending.extend_from_slice(bytes);

        let Some(last_newline) = pending.iter().rposition(|byte| *byte == b'\n') else {
            return Vec::new();
        };
        let rest = pending.split_off(last_newline + 1);
        let finished = std::mem::replace(pending, rest);

        finished
            .split(|byte| *byte == b'\n')
            .filter_map(Self::line)
            .collect()
    }

    /// The unfinished lines, once the log ended.
    fn finish(self) -> Vec<String> {
        [self.stdout, self.stderr]
            .iter()
            .filter_map(|pending| Self::line(pending))
            .collect()
    }

    /// One line, decoded, without the `\r` a TTY ends it with. Decoding waits for the whole line, so a character
    /// split between two chunks stays whole; bytes that are not UTF-8 read as `�`.
    fn line(bytes: &[u8]) -> Option<String> {
        if bytes.is_empty() {
            return None;
        }

        let line = bytes.strip_suffix(b"\r").unwrap_or(bytes);

        Some(String::from_utf8_lossy(line).into_owned())
    }
}

/// Where a followed log is.
struct Following {
    output: ByteStream,
    /// The frames of a container without a TTY; none for one with a TTY, whose bytes come as they are.
    demux: Option<Demux>,
    lines: LogLines,
    ready: VecDeque<Result<String, DockerError>>,
    has_ended: bool,
}

impl Following {
    /// The lines that `chunk` finishes.
    fn read(&mut self, chunk: &[u8]) -> Result<Vec<String>, DockerError> {
        let Some(demux) = &mut self.demux else {
            return Ok(self.lines.push(Output::Stdout, chunk));
        };
        let pieces = demux
            .push(chunk)
            .map_err(|error| DockerError::daemon(FOLLOWING, error))?;

        Ok(pieces
            .into_iter()
            .flat_map(|(output, bytes)| self.lines.push(output, bytes))
            .collect())
    }

    /// The last lines, once the log ended, and the error of a log that ended inside a frame.
    fn finish(&mut self) {
        let lines = std::mem::take(&mut self.lines).finish();

        self.ready.extend(lines.into_iter().map(Ok));

        if let Some(Err(error)) = self.demux.as_ref().map(Demux::finish) {
            self.ready
                .push_back(Err(DockerError::daemon(FOLLOWING, error)));
        }
    }
}

impl Docker {
    /// The log of the container of `project` whose id starts with `container_id`, followed: its last 200 lines, then
    /// each new one, stdout and stderr together. Each line starts with the time the daemon read it, as in
    /// `2026-11-24T10:00:00.000000000Z ready`. The stream ends when the container stops, and dropping it stops
    /// following.
    ///
    /// # Errors
    ///
    /// The errors of [`Docker::project_container`], and [`DockerError::Daemon`] when the daemon does not send the
    /// log. The stream ends with an error when the daemon fails while it is followed.
    pub async fn logs(
        &self,
        project: &str,
        container_id: &str,
    ) -> Result<impl Stream<Item = Result<String, DockerError>> + Send + 'static, DockerError> {
        let container = self.project_container(project, container_id).await?;
        let output = self
            .engine
            .containers()
            .logs(&container.id, true, true, true, true, TAIL)
            .await
            .map_err(|error| DockerError::daemon(FOLLOWING, error))?;
        let following = Following {
            demux: (!output.has_type(RAW_STREAM)).then(Demux::default),
            output,
            lines: LogLines::default(),
            ready: VecDeque::new(),
            has_ended: false,
        };

        Ok(stream::unfold(following, Self::next_line))
    }

    /// The next line of a followed log, once it is whole.
    async fn next_line(
        mut following: Following,
    ) -> Option<(Result<String, DockerError>, Following)> {
        loop {
            if let Some(line) = following.ready.pop_front() {
                return Some((line, following));
            }

            if following.has_ended {
                return None;
            }

            match following.output.next().await {
                Some(Ok(chunk)) => match following.read(&chunk) {
                    Ok(lines) => following.ready.extend(lines.into_iter().map(Ok)),
                    Err(error) => {
                        following.has_ended = true;
                        following.ready.push_back(Err(error));
                    }
                },
                Some(Err(error)) => {
                    following.has_ended = true;
                    following
                        .ready
                        .push_back(Err(DockerError::daemon(FOLLOWING, error)));
                }
                None => {
                    following.has_ended = true;
                    following.finish();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{LogLines, Output};

    #[test]
    fn cuts_a_chunk_into_its_lines() {
        let mut lines = LogLines::default();

        assert_eq!(lines.push(Output::Stdout, b"one\ntwo\n"), ["one", "two"]);
    }

    #[test]
    fn reads_a_line_split_across_chunks_once_it_is_whole() {
        let mut lines = LogLines::default();

        assert!(lines.push(Output::Stdout, b"hal").is_empty());
        assert_eq!(lines.push(Output::Stdout, b"f\nnext"), ["half"]);
        assert_eq!(lines.push(Output::Stdout, b"\n"), ["next"]);
    }

    #[test]
    fn keeps_a_line_of_stderr_apart_from_an_unfinished_one_of_stdout() {
        let mut lines = LogLines::default();

        assert!(lines.push(Output::Stdout, b"out ").is_empty());
        assert_eq!(lines.push(Output::Stderr, b"err\n"), ["err"]);
        assert_eq!(lines.push(Output::Stdout, b"line\n"), ["out line"]);
    }

    #[test]
    fn keeps_a_character_split_across_chunks_whole() {
        let mut lines = LogLines::default();
        let bytes = "é\n".as_bytes();

        assert!(lines.push(Output::Stdout, &bytes[..1]).is_empty());
        assert_eq!(lines.push(Output::Stdout, &bytes[1..]), ["é"]);
    }

    #[test]
    fn drops_the_carriage_return_of_a_tty() {
        let mut lines = LogLines::default();

        assert_eq!(lines.push(Output::Stdout, b"prompt\r\n"), ["prompt"]);
    }

    #[test]
    fn hands_the_unfinished_lines_once_the_log_ends() {
        let mut lines = LogLines::default();

        lines.push(Output::Stdout, b"last");
        lines.push(Output::Stderr, b"failed");

        assert_eq!(lines.finish(), ["last", "failed"]);
    }
}

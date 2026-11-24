//! The logs of a container, followed line by line.

use std::collections::VecDeque;

use futures::{Stream, StreamExt, stream};
use quoll::ByteStream;

use super::engine::Containers as _;
use super::frames::{Demux, Output, Piece};
use super::{Docker, DockerError};

/// How many lines of the past a followed log starts with.
const TAIL: &str = "200";

/// The content type of the logs of a container with a TTY: its bytes as they are, in no frame.
const RAW_STREAM: &str = "application/vnd.docker.raw-stream";

/// What a failed read of a log says it was doing.
const FOLLOWING: &str = "follow a container's logs";

/// The longest line kept: past it, the bytes read so far go out as a line of their own, so that a log with no line
/// break, as a progress bar a TTY draws with `\r` or binary output, does not grow without limit.
const LONGEST_LINE: usize = 64 * 1024;

/// The longest time the daemon puts before a line, with the space after it, as `2026-11-24T10:00:00.000000000Z `.
const LONGEST_TIMESTAMP: usize = 40;

/// Cuts the bytes of a log into lines. Each output keeps its own unfinished line, so that a line of stderr written
/// between two halves of one of stdout splits neither.
#[derive(Debug, Default)]
struct LogLines {
    stdout: PendingLine,
    stderr: PendingLine,
}

/// The unfinished line of an output.
#[derive(Debug, Default)]
struct PendingLine {
    bytes: Vec<u8>,
    /// How many of `bytes` are the time of a line cut at [`LONGEST_LINE`], which each of its pieces starts with.
    carried: usize,
}

impl LogLines {
    /// The lines that `bytes`, written to `output`, finish: those they end, and the pieces of those they make reach
    /// [`LONGEST_LINE`]. Only `bytes` are searched for line breaks, never what came before them.
    fn push(&mut self, output: Output, bytes: &[u8]) -> Vec<String> {
        let pending = match output {
            Output::Stdout => &mut self.stdout,
            Output::Stderr => &mut self.stderr,
        };
        let mut lines = Vec::new();

        for piece in bytes.split_inclusive(|byte| *byte == b'\n') {
            let (text, is_whole) = match piece.strip_suffix(b"\n") {
                Some(text) => (text, true),
                None => (piece, false),
            };

            pending.extend(text, &mut lines);

            if is_whole {
                lines.extend(pending.take());
            }
        }

        lines
    }

    /// The unfinished lines, once the log ended.
    fn finish(self) -> Vec<String> {
        [self.stdout, self.stderr]
            .into_iter()
            .filter_map(|mut pending| pending.take())
            .collect()
    }
}

impl PendingLine {
    /// Adds `text` to the line, and gives out to `lines` each piece of it that reaches [`LONGEST_LINE`]. The next
    /// piece starts with the time the line starts with, so that each line given out starts with its time.
    fn extend(&mut self, mut text: &[u8], lines: &mut Vec<String>) {
        while self.bytes.len() + text.len() >= LONGEST_LINE {
            let (head, rest) = text.split_at(LONGEST_LINE - self.bytes.len());

            self.bytes.extend_from_slice(head);

            let timestamp = Self::timestamp(&self.bytes).to_vec();

            lines.extend(self.take());
            self.carried = timestamp.len();
            self.bytes = timestamp;
            text = rest;
        }

        self.bytes.extend_from_slice(text);
    }

    /// The line, decoded, without the `\r` a TTY ends it with, and empties it; nothing when no text is left past its
    /// carried time. Decoding waits for the whole line, so a character split between two chunks stays whole, unless a
    /// cut at [`LONGEST_LINE`] splits it; bytes that are not UTF-8 read as `�`.
    fn take(&mut self) -> Option<String> {
        let bytes = std::mem::take(&mut self.bytes);
        let carried = std::mem::take(&mut self.carried);
        let line = bytes.strip_suffix(b"\r").unwrap_or(&bytes);

        if line.len() <= carried {
            return None;
        }

        Some(String::from_utf8_lossy(line).into_owned())
    }

    /// The time the daemon put at the start of `line`, with the space after it; nothing for a line that does not
    /// start with a digit, or with no space early enough.
    fn timestamp(line: &[u8]) -> &[u8] {
        if !line.first().is_some_and(u8::is_ascii_digit) {
            return &[];
        }

        line.iter()
            .take(LONGEST_TIMESTAMP)
            .position(|byte| *byte == b' ')
            .map_or(&[], |space| &line[..=space])
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
    /// Reads `chunk`: the lines it finishes, and the end of the log when its frames say the daemon failed.
    fn read(&mut self, chunk: &[u8]) {
        let Some(demux) = &mut self.demux else {
            let lines = self.lines.push(Output::Stdout, chunk);

            self.ready.extend(lines.into_iter().map(Ok));

            return;
        };

        for piece in demux.push(chunk) {
            match piece {
                Piece::Output(output, bytes) => {
                    let lines = self.lines.push(output, bytes);

                    self.ready.extend(lines.into_iter().map(Ok));
                }
                Piece::Failed(error) => {
                    return self.end(Some(DockerError::daemon(FOLLOWING, error)));
                }
            }
        }
    }

    /// Ends the log: its unfinished lines first, then its error. What the daemon wrote in its frames, or in place of
    /// them, says more than `error`, the failed connection that may follow it; `error` says more than frames cut
    /// short.
    fn end(&mut self, error: Option<DockerError>) {
        let lines = std::mem::take(&mut self.lines).finish();
        let unfinished = self.demux.as_ref().and_then(|demux| demux.finish().err());
        let error = match unfinished {
            Some(message) if message.is_message() => Some(DockerError::daemon(FOLLOWING, message)),
            cut => error.or_else(|| cut.map(|cut| DockerError::daemon(FOLLOWING, cut))),
        };

        self.has_ended = true;
        self.ready.extend(lines.into_iter().map(Ok));
        self.ready.extend(error.map(Err));
    }
}

impl Docker {
    /// The log of the container of `project` whose id starts with `container_id`, followed: its last 200 lines, then
    /// each new one, stdout and stderr together. Each line starts with the time the daemon read it, as in
    /// `2026-11-24T10:00:00.000000000Z ready`. A line longer than 64 KiB comes in pieces, each starting with the time
    /// of the line. The stream ends when the container stops, and dropping it stops following.
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
                Some(Ok(chunk)) => following.read(&chunk),
                Some(Err(error)) => following.end(Some(DockerError::daemon(FOLLOWING, error))),
                None => following.end(None),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use quoll::Error;

    use super::*;

    /// The items of a log whose daemon sends `chunks`, in frames when `demux` is set.
    async fn followed(
        chunks: Vec<quoll::Result<Vec<u8>>>,
        demux: Option<Demux>,
    ) -> Vec<Result<String, String>> {
        let following = Following {
            output: ByteStream::try_new(stream::iter(chunks)),
            demux,
            lines: LogLines::default(),
            ready: VecDeque::new(),
            has_ended: false,
        };

        stream::unfold(following, Docker::next_line)
            .map(|item| {
                item.map_err(|error| {
                    std::error::Error::source(&error)
                        .map(ToString::to_string)
                        .unwrap_or_default()
                })
            })
            .collect()
            .await
    }

    #[tokio::test]
    async fn gives_the_unfinished_line_before_the_error_that_ends_the_log() {
        let items = followed(
            vec![
                Ok(b"fatal: out of memory".to_vec()),
                Err(Error::internal("the connection was cut")),
            ],
            None,
        )
        .await;

        assert_eq!(items.len(), 2, "{items:?}");
        assert_eq!(items[0], Ok("fatal: out of memory".to_owned()));
        assert!(items[1].is_err(), "{items:?}");
    }

    #[tokio::test]
    async fn gives_what_the_daemon_wrote_rather_than_the_failed_connection_after_it() {
        let chunk = b"Error grabbing logs: unexpected EOF".to_vec();

        let items = followed(
            vec![Ok(chunk), Err(Error::internal("the connection was cut"))],
            Some(Demux::default()),
        )
        .await;

        assert_eq!(
            items,
            [Err(
                "the logs hold bytes that are not frames: Error grabbing logs: unexpected EOF"
                    .to_owned()
            )]
        );
    }

    #[tokio::test]
    async fn gives_the_unfinished_line_before_the_daemons_error_in_its_frames() {
        let frame = |stream: u8, payload: &[u8]| {
            let size = u32::try_from(payload.len()).expect("a small payload");

            [&[stream, 0, 0, 0][..], &size.to_be_bytes(), payload].concat()
        };
        let chunk = [frame(1, b"partial"), frame(3, b"the log driver failed")].concat();

        let items = followed(vec![Ok(chunk)], Some(Demux::default())).await;

        assert_eq!(
            items,
            [
                Ok("partial".to_owned()),
                Err("error from daemon in stream: the log driver failed".to_owned())
            ]
        );
    }

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
    fn gives_out_a_line_with_no_break_at_the_longest_line() {
        let mut lines = LogLines::default();
        let chunk = [b'#'; 1024];
        let mut given = Vec::new();

        // A progress bar redrawn with `\r` alone, 200 KiB of it.
        for _ in 0..200 {
            given.extend(lines.push(Output::Stdout, &chunk));
        }

        assert_eq!(given.len(), 3);
        assert!(given.iter().all(|line| line.len() == LONGEST_LINE));
        assert_eq!(lines.stdout.bytes.len(), 200 * 1024 - 3 * LONGEST_LINE);
    }

    #[test]
    fn starts_each_piece_of_a_long_line_with_its_time() {
        let mut lines = LogLines::default();
        let time = "2026-11-24T10:00:00.000000000Z ";
        let text = "a".repeat(2 * LONGEST_LINE);

        let given = lines.push(Output::Stdout, format!("{time}{text}\n").as_bytes());
        let texts: Vec<&str> = given
            .iter()
            .filter_map(|line| line.strip_prefix(time))
            .collect();

        assert_eq!(given.len(), 3);
        assert_eq!(texts.len(), 3, "each piece starts with the time");
        assert_eq!(texts.concat(), text);
    }

    #[test]
    fn gives_no_empty_line_for_the_carriage_return_after_a_cut() {
        let mut lines = LogLines::default();
        let mut bytes = vec![b'a'; LONGEST_LINE];

        bytes.extend(b"\r\nnext\n");

        assert_eq!(lines.push(Output::Stdout, &bytes).len(), 2);
    }

    #[test]
    fn gives_no_line_for_a_blank_line_of_a_tty() {
        let mut lines = LogLines::default();

        assert_eq!(lines.push(Output::Stdout, b"\r\none\r\n"), ["one"]);
    }

    #[test]
    fn cuts_a_long_line_at_the_longest_line_and_goes_on() {
        let mut lines = LogLines::default();
        let mut bytes = vec![b'a'; LONGEST_LINE + 10];

        bytes.extend(b"\nnext\n");

        let given = lines.push(Output::Stdout, &bytes);

        assert_eq!(
            given.iter().map(String::len).collect::<Vec<_>>(),
            [LONGEST_LINE, 10, 4]
        );
    }

    #[test]
    fn hands_the_unfinished_lines_once_the_log_ends() {
        let mut lines = LogLines::default();

        lines.push(Output::Stdout, b"last");
        lines.push(Output::Stderr, b"failed");

        assert_eq!(lines.finish(), ["last", "failed"]);
    }
}

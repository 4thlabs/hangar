//! Docker's frames: the output of a container with no TTY, each piece of it after a header of 8 bytes, the stream it
//! was written to, three zeros, and the size of the piece, a big-endian `u32`.

/// The size of a frame's header.
const HEADER: usize = 8;

/// The stream of a frame that holds an error of the daemon rather than output, as Docker's own `stdcopy` reads it.
const SYSTEM_ERROR: u8 = 3;

/// How much of an error of the daemon, or of bytes that are not frames, is kept for its message.
const LONGEST_ERROR: usize = 64 * 1024;

/// The output a piece of payload was written to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Output {
    Stdout,
    Stderr,
}

/// What a chunk of frames holds, in order: pieces of output, then a failure after which nothing more is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Piece<'a> {
    /// Bytes written to `Output`.
    Output(Output, &'a [u8]),
    /// The end of the frames.
    Failed(FrameError),
}

/// What the payload of the frame being read is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Payload {
    Output(Output),
    SystemError,
}

/// Splits frames as their bytes come, cut anywhere: a payload of output is given as it comes, never held whole, so
/// that a long line of a followed container shows as soon as its bytes do.
#[derive(Debug, Default)]
pub(crate) struct Demux {
    header: [u8; HEADER],
    /// How much of the next header has come.
    filled: usize,
    /// The payload of the frame being read, and how many of its bytes are still to come.
    payload: Option<(Payload, usize)>,
    /// The error of the daemon read so far.
    system_error: Vec<u8>,
    /// The bytes read since a header that did not read as one, which are the message: kept until the end of the
    /// stream, or until [`LONGEST_ERROR`].
    not_frames: Option<Vec<u8>>,
    has_failed: bool,
}

impl Demux {
    /// The pieces `chunk` holds, in order. After a [`Piece::Failed`], nothing more is read.
    pub(crate) fn push<'a>(&mut self, mut chunk: &'a [u8]) -> Vec<Piece<'a>> {
        let mut pieces = Vec::new();

        while !chunk.is_empty() && !self.has_failed {
            if let Some(kept) = &mut self.not_frames {
                Self::keep(kept, chunk);

                if kept.len() >= LONGEST_ERROR {
                    let message = Self::text(kept);

                    pieces.push(self.fail(FrameError::NotFrames(message)));
                }

                break;
            }

            if let Some((payload, left)) = self.payload {
                let (bytes, rest) = chunk.split_at(left.min(chunk.len()));
                let left = left - bytes.len();

                self.payload = (left > 0).then_some((payload, left));
                chunk = rest;

                match payload {
                    Payload::Output(output) => pieces.push(Piece::Output(output, bytes)),
                    Payload::SystemError => {
                        Self::keep(&mut self.system_error, bytes);

                        if left == 0 {
                            pieces.push(self.system_error());
                        }
                    }
                }

                continue;
            }

            let (part, rest) = chunk.split_at((HEADER - self.filled).min(chunk.len()));

            self.header[self.filled..self.filled + part.len()].copy_from_slice(part);
            self.filled += part.len();
            chunk = rest;

            if self.filled < HEADER {
                break;
            }

            self.filled = 0;

            let Some(payload) = self.payload_kind() else {
                // The daemon wrote something else than a frame, such as the text of an error: it is the message,
                // whatever chunks it comes in.
                self.not_frames = Some(self.header.to_vec());

                continue;
            };
            let size = u32::from_be_bytes([
                self.header[4],
                self.header[5],
                self.header[6],
                self.header[7],
            ]);

            self.payload = (size > 0).then_some((payload, size as usize));

            if size == 0 && payload == Payload::SystemError {
                pieces.push(self.system_error());
            }
        }

        pieces
    }

    /// Says the bytes have ended: the error of the daemon or the bytes that are not frames read so far, or
    /// [`FrameError::Truncated`] when they ended inside a frame of output.
    pub(crate) fn finish(&self) -> Result<(), FrameError> {
        if self.has_failed {
            return Ok(());
        }

        if let Some(kept) = &self.not_frames {
            return Err(FrameError::NotFrames(Self::text(kept)));
        }

        match self.payload {
            Some((Payload::SystemError, _)) => {
                return Err(FrameError::Daemon(Self::text(&self.system_error)));
            }
            Some((Payload::Output(_), _)) => return Err(FrameError::Truncated),
            None => {}
        }

        if self.filled == 0 {
            return Ok(());
        }

        let partial = &self.header[..self.filled];
        let may_be_a_header =
            partial[0] <= SYSTEM_ERROR && partial[1..].iter().take(3).all(|byte| *byte == 0);

        if may_be_a_header {
            return Err(FrameError::Truncated);
        }

        Err(FrameError::NotFrames(Self::text(partial)))
    }

    /// What the header read holds, when it is one: a known stream and three zeros.
    fn payload_kind(&self) -> Option<Payload> {
        if self.header[1..4] != [0, 0, 0] {
            return None;
        }

        // Stdin, 0, goes with stdout, as Docker's own `stdcopy` writes it.
        match self.header[0] {
            0 | 1 => Some(Payload::Output(Output::Stdout)),
            2 => Some(Payload::Output(Output::Stderr)),
            SYSTEM_ERROR => Some(Payload::SystemError),
            _ => None,
        }
    }

    /// The error of the daemon, once its frame is whole.
    fn system_error(&mut self) -> Piece<'static> {
        let message = Self::text(&std::mem::take(&mut self.system_error));

        self.fail(FrameError::Daemon(message))
    }

    /// The failure after which nothing more is read.
    fn fail(&mut self, error: FrameError) -> Piece<'static> {
        self.has_failed = true;
        self.payload = None;
        self.not_frames = None;

        Piece::Failed(error)
    }

    /// Adds `bytes` to the message `kept`, up to [`LONGEST_ERROR`].
    fn keep(kept: &mut Vec<u8>, bytes: &[u8]) {
        let room = LONGEST_ERROR.saturating_sub(kept.len());

        kept.extend_from_slice(&bytes[..room.min(bytes.len())]);
    }

    /// The text of a message, without its last line break.
    fn text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).trim_end().to_owned()
    }
}

/// Bytes that are not Docker's frames, or that say the daemon failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum FrameError {
    /// A frame of the daemon's own errors, stream 3, with its message.
    #[error("error from daemon in stream: {0}")]
    Daemon(String),
    /// A header naming no known stream: the bytes from there are not frames, such as an error the daemon wrote as
    /// text.
    #[error("the logs hold bytes that are not frames: {0}")]
    NotFrames(String),
    /// The logs ended inside a frame.
    #[error("the logs ended inside a frame")]
    Truncated,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame of `payload`, written to `stream`.
    fn frame(stream: u8, payload: &[u8]) -> Vec<u8> {
        let size = u32::try_from(payload.len()).expect("a small payload");
        let mut frame = vec![stream, 0, 0, 0];

        frame.extend(size.to_be_bytes());
        frame.extend(payload);
        frame
    }

    /// What `demux` gives of `chunks`: the pieces of each output put end to end, and the failure if there is one.
    fn read(demux: &mut Demux, chunks: &[&[u8]]) -> (Vec<u8>, Vec<u8>, Option<FrameError>) {
        let (mut stdout, mut stderr, mut failure) = (Vec::new(), Vec::new(), None);

        for chunk in chunks {
            for piece in demux.push(chunk) {
                match piece {
                    Piece::Output(Output::Stdout, bytes) => stdout.extend(bytes),
                    Piece::Output(Output::Stderr, bytes) => stderr.extend(bytes),
                    Piece::Failed(error) => failure = Some(error),
                }
            }
        }

        (stdout, stderr, failure)
    }

    #[test]
    fn frames_cut_anywhere_give_each_output_its_bytes() {
        let bytes = [
            frame(1, b"hello\n"),
            frame(2, b"oops\n"),
            frame(0, b""),
            frame(1, b"bye\n"),
        ]
        .concat();

        for cut in 1..bytes.len() {
            for second in cut..bytes.len() {
                let mut demux = Demux::default();
                let chunks = [&bytes[..cut], &bytes[cut..second], &bytes[second..]];

                let (stdout, stderr, failure) = read(&mut demux, &chunks);

                assert_eq!(stdout, b"hello\nbye\n", "cut at {cut} and {second}");
                assert_eq!(stderr, b"oops\n", "cut at {cut} and {second}");
                assert_eq!(failure, None, "cut at {cut} and {second}");
                assert_eq!(demux.finish(), Ok(()));
            }
        }
    }

    #[test]
    fn a_payload_is_given_as_its_bytes_come() {
        let bytes = frame(1, b"a long line\n");
        let mut demux = Demux::default();

        let pieces = demux.push(&bytes[..10]);

        assert_eq!(pieces, [Piece::Output(Output::Stdout, &b"a "[..])]);
    }

    #[test]
    fn logs_that_end_inside_a_frame_are_an_error() {
        let bytes = frame(2, b"cut");

        for cut in 1..bytes.len() {
            let mut demux = Demux::default();

            demux.push(&bytes[..cut]);

            assert_eq!(demux.finish(), Err(FrameError::Truncated), "cut at {cut}");
        }
    }

    #[test]
    fn a_frame_of_the_daemons_errors_is_its_message_after_the_output_before_it() {
        let bytes = [
            frame(1, b"last\n"),
            frame(3, b"the log driver failed\n"),
            frame(1, b"after\n"),
        ]
        .concat();

        for cut in 1..bytes.len() {
            let mut demux = Demux::default();

            let (stdout, _, failure) = read(&mut demux, &[&bytes[..cut], &bytes[cut..]]);

            assert_eq!(stdout, b"last\n", "cut at {cut}");
            assert_eq!(
                failure,
                Some(FrameError::Daemon("the log driver failed".to_owned())),
                "cut at {cut}"
            );
            assert_eq!(demux.finish(), Ok(()));
        }
    }

    #[test]
    fn bytes_that_are_not_frames_are_the_message_whatever_chunks_they_come_in() {
        let bytes = [
            frame(1, b"ok\n"),
            b"Error grabbing logs: unexpected EOF\n".to_vec(),
        ]
        .concat();

        for cut in 1..bytes.len() {
            let mut demux = Demux::default();

            let (stdout, _, failure) = read(&mut demux, &[&bytes[..cut], &bytes[cut..]]);

            assert_eq!(stdout, b"ok\n", "cut at {cut}");
            assert_eq!(failure, None, "cut at {cut}");
            assert_eq!(
                demux.finish(),
                Err(FrameError::NotFrames(
                    "Error grabbing logs: unexpected EOF".to_owned()
                )),
                "cut at {cut}"
            );
        }
    }

    #[test]
    fn bytes_that_are_not_frames_fail_at_the_longest_error() {
        let mut demux = Demux::default();
        let text = vec![b'x'; LONGEST_ERROR + 100];

        let (_, _, failure) = read(&mut demux, &[&text[..10], &text[10..]]);

        assert_eq!(
            failure,
            Some(FrameError::NotFrames("x".repeat(LONGEST_ERROR)))
        );
    }

    #[test]
    fn text_shorter_than_a_header_is_the_message() {
        let mut demux = Demux::default();

        read(&mut demux, &[b"oops\n"]);

        assert_eq!(
            demux.finish(),
            Err(FrameError::NotFrames("oops".to_owned()))
        );
    }

    #[test]
    fn a_frame_of_the_daemons_errors_cut_short_keeps_what_came() {
        let bytes = frame(3, b"the log driver failed");
        let mut demux = Demux::default();

        let (_, _, failure) = read(&mut demux, &[&bytes[..HEADER + 7]]);

        assert_eq!(failure, None);
        assert_eq!(
            demux.finish(),
            Err(FrameError::Daemon("the log".to_owned()))
        );
    }

    #[test]
    fn a_frame_of_an_unknown_stream_is_not_frames() {
        let mut demux = Demux::default();

        read(&mut demux, &[&frame(7, b"x")]);

        assert!(
            matches!(demux.finish(), Err(FrameError::NotFrames(_))),
            "{:?}",
            demux.finish()
        );
    }
}

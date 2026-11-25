//! The end of a child's stderr, which a failed run reports.

use std::collections::VecDeque;

/// The last lines of a child's stderr, where the cause of a failure is. It holds at most [`StderrTail::LINES`] lines
/// of [`StderrTail::LINE_BYTES`] each, however long the stderr: a long pull's progress must not grow memory.
#[derive(Debug, Default)]
pub(crate) struct StderrTail {
    lines: VecDeque<String>,
    /// The start of the line the child is writing, cut at [`StderrTail::LINE_BYTES`].
    partial: Vec<u8>,
}

impl StderrTail {
    /// How many lines a failure reports.
    pub(crate) const LINES: usize = 20;

    /// How much of a line is kept: its start, which names the error.
    const LINE_BYTES: usize = 1024;

    /// Takes in what the child wrote to stderr. A carriage return ends a line as a newline does: a progress that
    /// redraws itself with `\r` would otherwise be one long line, cut at its start, before the error at its end.
    pub(crate) fn write(&mut self, chunk: &[u8]) {
        for piece in chunk.split_inclusive(|byte| Self::ends_line(*byte)) {
            let room = Self::LINE_BYTES.saturating_sub(self.partial.len());

            self.partial
                .extend_from_slice(&piece[..piece.len().min(room)]);

            if piece.last().copied().is_some_and(Self::ends_line) {
                self.end_line();
            }
        }
    }

    /// Whether `byte` ends a line; `\r\n` ends it once, as the empty line between them is left out.
    fn ends_line(byte: u8) -> bool {
        byte == b'\n' || byte == b'\r'
    }

    /// The last lines, blank ones left out, joined by newlines.
    pub(crate) fn finish(mut self) -> String {
        self.end_line();

        Vec::from(self.lines).join("\n")
    }

    /// Keeps the line being written, unless it is blank, and forgets the oldest beyond [`StderrTail::LINES`].
    fn end_line(&mut self) {
        // A line cut at `LINE_BYTES` may end inside a character: drop its start rather than show it as garbage.
        if let Err(error) = std::str::from_utf8(&self.partial)
            && error.error_len().is_none()
        {
            self.partial.truncate(error.valid_up_to());
        }

        let line = String::from_utf8_lossy(&self.partial).trim_end().to_owned();

        self.partial.clear();

        if line.trim().is_empty() {
            return;
        }

        if self.lines.len() == Self::LINES {
            self.lines.pop_front();
        }

        self.lines.push_back(line);
    }
}

#[cfg(test)]
mod tests {
    use super::StderrTail;

    #[test]
    fn keeps_the_last_lines_of_a_long_stderr() {
        let mut tail = StderrTail::default();

        for i in 0..5000 {
            tail.write(format!("progress {i}\n").as_bytes());
        }

        tail.write(b"disk full\n");

        let tail = tail.finish();
        let lines: Vec<&str> = tail.lines().collect();

        assert_eq!(lines.len(), StderrTail::LINES);
        assert_eq!(lines[0], "progress 4981");
        assert!(tail.ends_with("progress 4999\ndisk full"));
    }

    #[test]
    fn joins_a_line_written_in_pieces_and_leaves_out_blank_ones() {
        let mut tail = StderrTail::default();

        tail.write(b"Error response ");
        tail.write(b"from daemon\r\n\n  \n");
        tail.write(b"no newline at the end");

        assert_eq!(
            tail.finish(),
            "Error response from daemon\nno newline at the end"
        );
    }

    #[test]
    fn ends_a_line_at_a_carriage_return() {
        let mut tail = StderrTail::default();
        let progress = "Downloading 42%\r".repeat(1000);

        tail.write(format!("{progress}error: boom\n").as_bytes());

        let tail = tail.finish();
        let lines: Vec<&str> = tail.lines().collect();

        assert_eq!(lines.len(), StderrTail::LINES);
        assert_eq!(lines.last(), Some(&"error: boom"));
    }

    #[test]
    fn cuts_a_long_line_at_a_character_boundary() {
        let mut tail = StderrTail::default();
        let long_line = format!("{}é and more\n", "x".repeat(StderrTail::LINE_BYTES - 1));

        tail.write(long_line.as_bytes());

        assert_eq!(tail.finish(), "x".repeat(StderrTail::LINE_BYTES - 1));
    }

    #[test]
    fn keeps_the_start_of_a_long_line() {
        let mut tail = StderrTail::default();
        let long_line = format!("network conflict {}\n", "x".repeat(10_000));

        tail.write(long_line.as_bytes());

        let tail = tail.finish();

        assert_eq!(tail.len(), StderrTail::LINE_BYTES);
        assert!(tail.starts_with("network conflict"));
    }
}

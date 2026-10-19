//! The smallest HTTP/1.1 the core needs: one request per connection, a bounded head and body,
//! `Content-Length` only (node's `fetch` sends a sized body for JSON), and a JSON reply with
//! `Connection: close`. Pure parsing is split from I/O so it is unit-tested.

use std::io::{Read, Write};
use std::time::{Duration, Instant};

pub const MAX_HEAD: usize = 16 * 1024;
pub const MAX_BODY: usize = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    /// Path without the query string.
    pub path: String,
    pub query: String,
    pub token: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Bad {
    /// Malformed or oversized: answer 400 / 413.
    Status(u16),
    /// The peer went away or timed out: drop the connection.
    Io,
}

/// Head bytes (through the blank line) → method, path, query, token, declared body length.
pub fn parse_head(head: &[u8]) -> Result<(Request, usize), Bad> {
    let text = std::str::from_utf8(head).map_err(|_| Bad::Status(400))?;
    let mut lines = text.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (Some(method), Some(target), Some(ver)) = (first.next(), first.next(), first.next()) else {
        return Err(Bad::Status(400));
    };
    if !ver.starts_with("HTTP/1.") || !target.starts_with('/') {
        return Err(Bad::Status(400));
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let (mut token, mut len) = (None, 0usize);
    for l in lines {
        let Some((k, v)) = l.split_once(':') else { continue };
        let v = v.trim();
        if k.eq_ignore_ascii_case("x-core-token") {
            token = Some(v.to_string());
        } else if k.eq_ignore_ascii_case("content-length") {
            len = v.parse().map_err(|_| Bad::Status(400))?;
        } else if k.eq_ignore_ascii_case("transfer-encoding") {
            return Err(Bad::Status(411));
        }
    }
    if len > MAX_BODY {
        return Err(Bad::Status(413));
    }
    Ok((Request { method: method.to_string(), path: path.to_string(), query: query.to_string(), token, body: Vec::new() }, len))
}

/// Reads one request: the head up to [`MAX_HEAD`], then exactly `Content-Length` body bytes.
/// The whole request must arrive before `deadline`: `arm` is handed the time left before every
/// read (the server sets it as the socket's read timeout), so a slow sender can't hold a slot.
/// A request without the right `token` is refused (401) as soon as its head is in, before any
/// body byte is read.
pub fn read_request(
    s: &mut impl Read,
    deadline: Instant,
    token: &str,
    arm: &mut dyn FnMut(Duration) -> std::io::Result<()>,
) -> Result<Request, Bad> {
    let mut read = |s: &mut dyn Read, buf: &mut [u8]| -> Result<usize, Bad> {
        let left = deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero()).ok_or(Bad::Io)?;
        arm(left).map_err(|_| Bad::Io)?;
        match s.read(buf) {
            Ok(0) | Err(_) => Err(Bad::Io),
            Ok(n) => Ok(n),
        }
    };
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];
    let end = loop {
        let n = read(s, &mut chunk)?;
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > MAX_HEAD {
            return Err(Bad::Status(431));
        }
    };
    let (mut req, len) = parse_head(&buf[..end])?;
    if !req.token.as_deref().is_some_and(|t| token_eq(t, token)) {
        return Err(Bad::Status(401));
    }
    let mut body = buf.split_off(end);
    body.truncate(len);
    let mut got = body.len();
    body.resize(len, 0);
    while got < len {
        got += read(s, &mut body[got..])?;
    }
    req.body = body;
    Ok(req)
}

pub fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        _ => "Internal Server Error",
    }
}

pub fn write_json(s: &mut impl Write, code: u16, body: &[u8]) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {code} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        reason(code),
        body.len()
    );
    s.write_all(head.as_bytes())?;
    s.write_all(body)?;
    s.flush()
}

/// One query parameter, percent-decoded (`+` is a space, as `URLSearchParams` writes it).
pub fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        (k == key).then(|| urlencoding::decode(&v.replace('+', " ")).map(|c| c.into_owned()).ok()).flatten()
    })
}

/// Same length and same bytes, without an early exit on the first difference.
pub fn token_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rd(raw: &[u8]) -> Result<Request, Bad> {
        read_request(&mut &raw[..], Instant::now() + Duration::from_secs(5), "abc", &mut |_| Ok(()))
    }

    #[test]
    fn reads_head_token_query_and_sized_body() {
        let raw = b"POST /v1/usage?x=1 HTTP/1.1\r\nHost: a\r\nX-Core-Token: abc\r\nContent-Length: 5\r\n\r\nhello";
        let r = rd(raw).unwrap();
        assert_eq!((r.method.as_str(), r.path.as_str(), r.query.as_str()), ("POST", "/v1/usage", "x=1"));
        assert_eq!(r.token.as_deref(), Some("abc"));
        assert_eq!(r.body, b"hello");
    }

    #[test]
    fn rejects_oversized_bodies_chunked_and_garbage() {
        let big = format!("POST / HTTP/1.1\r\nContent-Length: {}\r\n\r\n", MAX_BODY + 1);
        assert_eq!(rd(big.as_bytes()), Err(Bad::Status(413)));
        assert_eq!(rd(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"), Err(Bad::Status(411)));
        assert_eq!(rd(b"hello\r\n\r\n"), Err(Bad::Status(400)));
        assert_eq!(rd(b"GET / HTTP/1.1\r\n"), Err(Bad::Io));
        let long = format!("GET / HTTP/1.1\r\nX: {}\r\n", "a".repeat(MAX_HEAD + 10));
        assert_eq!(rd(long.as_bytes()), Err(Bad::Status(431)));
    }

    /// Hands out the head, then fails the test if anything reads further.
    struct HeadOnly(&'static [u8], bool);
    impl Read for HeadOnly {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            assert!(!self.1, "read past the head");
            self.1 = true;
            buf[..self.0.len()].copy_from_slice(self.0);
            Ok(self.0.len())
        }
    }

    #[test]
    fn refuses_a_wrong_token_before_reading_the_body_and_keeps_one_deadline() {
        let head = b"POST /v1/usage HTTP/1.1\r\nX-Core-Token: nope\r\nContent-Length: 900000\r\n\r\n";
        let end = Instant::now() + Duration::from_secs(5);
        assert_eq!(read_request(&mut HeadOnly(head, false), end, "abc", &mut |_| Ok(())), Err(Bad::Status(401)));
        let none = b"GET / HTTP/1.1\r\n\r\n";
        assert_eq!(read_request(&mut HeadOnly(none, false), end, "abc", &mut |_| Ok(())), Err(Bad::Status(401)));
        // each read gets only what is left of the one deadline; past it nothing is read
        let mut armed = Vec::new();
        let ok = b"GET / HTTP/1.1\r\nX-Core-Token: abc\r\n\r\n";
        assert!(read_request(&mut &ok[..], end, "abc", &mut |d| Ok(armed.push(d))).is_ok());
        assert!(armed.len() == 1 && armed[0] <= Duration::from_secs(5));
        assert_eq!(read_request(&mut &ok[..], Instant::now(), "abc", &mut |_| Ok(())), Err(Bad::Io));
    }

    #[test]
    fn decodes_query_params_and_compares_tokens() {
        assert_eq!(query_param("root=C%3A%5CUsers%5Cx+y&z=1", "root").as_deref(), Some("C:\\Users\\x y"));
        assert_eq!(query_param("a=1", "root"), None);
        assert!(token_eq("abcd", "abcd"));
        assert!(!token_eq("abcd", "abce"));
        assert!(!token_eq("abcd", "abc"));
    }
}

// FFI wrapper over async-opcua-types 0.19: decode a top-level Variant from the
// fuzzer's bytes, then re-encode it to canonical OPC-UA binary. The C harness
// compares our re-encoding to open62541's. Panic-safe: a decoder panic is
// reported as ok==2 (a Rust-side bug candidate), never unwound across the FFI
// boundary (that would be UB).
use std::io::Cursor;
use std::panic::catch_unwind;
use std::sync::Once;

use opcua_types::{BinaryDecodable, BinaryEncodable, ContextOwned, Variant};

#[repr(C)]
pub struct UaFp {
    pub ok: i32,    // 0 reject, 1 accept, 2 panic
    pub relen: i32, // re-encoded length, or -1
}

static HOOK: Once = Once::new();

#[no_mangle]
pub extern "C" fn rust_ua_decode(
    data: *const u8,
    size: usize,
    rebuf: *mut u8,
    cap: i32,
    out: *mut UaFp,
) {
    HOOK.call_once(|| std::panic::set_hook(Box::new(|_| {})));
    let out = unsafe { &mut *out };
    out.ok = 0;
    out.relen = -1;
    let input: &[u8] = if size == 0 || data.is_null() {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(data, size) }
    };

    let result = catch_unwind(|| {
        let owned = ContextOwned::default();
        let ctx = owned.context();
        let mut cur = Cursor::new(input);
        match Variant::decode(&mut cur, &ctx) {
            Ok(v) => {
                let mut buf: Vec<u8> = Vec::new();
                let mut wc = Cursor::new(&mut buf);
                if v.encode(&mut wc, &ctx).is_ok() {
                    Some(buf)
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    });

    match result {
        Ok(Some(buf)) => {
            out.ok = 1;
            out.relen = buf.len() as i32;
            if !rebuf.is_null() && (buf.len() as i32) <= cap {
                unsafe { std::ptr::copy_nonoverlapping(buf.as_ptr(), rebuf, buf.len()) };
            }
        }
        Ok(None) => out.ok = 0,
        Err(_) => out.ok = 2,
    }
}

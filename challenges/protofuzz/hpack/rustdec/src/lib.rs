use hpack::Decoder;
use std::slice;

fn put(out: &mut [u8], pos: &mut usize, b: &[u8]) -> bool {
    let n = b.len();
    if *pos + n > out.len() {
        return false;
    }
    out[*pos..*pos + n].copy_from_slice(b);
    *pos += n;
    true
}

#[no_mangle]
pub extern "C" fn rhpack_new() -> *mut Decoder<'static> {
    static HOOK: std::sync::Once = std::sync::Once::new();
    HOOK.call_once(|| std::panic::set_hook(Box::new(|_| {})));
    Box::into_raw(Box::new(Decoder::new()))
}

#[no_mangle]
pub extern "C" fn rhpack_free(d: *mut Decoder<'static>) {
    if !d.is_null() {
        unsafe { drop(Box::from_raw(d)) };
    }
}

#[no_mangle]
pub extern "C" fn rhpack_set_max_table(d: *mut Decoder<'static>, sz: usize) {
    if d.is_null() {
        return;
    }
    unsafe { &mut *d }.set_max_table_size(sz);
}

#[no_mangle]
pub extern "C" fn rhpack_decode(
    d: *mut Decoder<'static>,
    inp: *const u8,
    inlen: usize,
    out: *mut u8,
    outcap: usize,
) -> isize {
    if d.is_null() || (inp.is_null() && inlen != 0) || out.is_null() {
        return -2;
    }
    let dec = unsafe { &mut *d };
    let input = unsafe { slice::from_raw_parts(inp, inlen) };
    let outb = unsafe { slice::from_raw_parts_mut(out, outcap) };
    let decoded = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| dec.decode(input)));
    let decoded = match decoded {
        Ok(r) => r,
        Err(_) => return -4,
    };
    match decoded {
        Ok(list) => {
            let mut pos = 0usize;
            for (n, v) in &list {
                if !put(outb, &mut pos, &(n.len() as u32).to_le_bytes())
                    || !put(outb, &mut pos, n)
                    || !put(outb, &mut pos, &(v.len() as u32).to_le_bytes())
                    || !put(outb, &mut pos, v)
                {
                    return -3;
                }
            }
            pos as isize
        }
        Err(_) => -1,
    }
}

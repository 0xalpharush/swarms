// rmodbus (Rust) side of the libmodbus differential.
//
// Two entry points:
//  * rmodbus_parse_tcp  — accept/reject only (kept for the framing differential,
//    which is noise-dominated; see README).
//  * rmodbus_eval_tcp   — FIELD-LEVEL: parse AND process the request against a
//    full-range server context, then report the Modbus EXCEPTION CODE rmodbus
//    raises (0 = none). Comparing exception codes to libmodbus's tests whether
//    the two stacks agree on which requests are *illegal* and *why* — strictly
//    stronger than accept/reject, and the security-relevant semantic.
//
// Returns: >=0  the exception code (0 = request accepted, no exception),
//          -1   malformed frame (parse error),
//          -4   panic (should not happen; a rmodbus bug candidate).
use rmodbus::server::context::ModbusContext;
use rmodbus::server::storage::ModbusStorageFull;
use rmodbus::server::ModbusFrame;
use rmodbus::ModbusProto;
use std::slice;

#[no_mangle]
pub extern "C" fn rmodbus_parse_tcp(inp: *const u8, inlen: usize) -> i32 {
    if inp.is_null() && inlen != 0 {
        return -2;
    }
    let input = unsafe { slice::from_raw_parts(inp, inlen) };
    let unit = if input.len() > 6 { input[6] } else { 1 };
    let r = std::panic::catch_unwind(|| {
        let mut response: Vec<u8> = Vec::new();
        let mut frame = ModbusFrame::new(unit, input, ModbusProto::TcpUdp, &mut response);
        match frame.parse() {
            Ok(()) => 0i32,
            Err(_) => -1i32,
        }
    });
    r.unwrap_or(-4)
}

#[no_mangle]
pub extern "C" fn rmodbus_eval_tcp(inp: *const u8, inlen: usize) -> i32 {
    if inp.is_null() && inlen != 0 {
        return -2;
    }
    let input = unsafe { slice::from_raw_parts(inp, inlen) };
    let unit = if input.len() > 6 { input[6] } else { 1 };
    let r = std::panic::catch_unwind(|| {
        // full-range context so address checks match libmodbus's 0x10000 mapping
        let mut ctx: Box<ModbusStorageFull> = Box::new(ModbusStorageFull::new());
        let mut response: Vec<u8> = Vec::new();
        let mut frame = ModbusFrame::new(unit, input, ModbusProto::TcpUdp, &mut response);
        if frame.parse().is_err() {
            return -1i32;
        }
        if frame.processing_required {
            let _ = if frame.readonly {
                frame.process_read(ctx.as_ref())
            } else {
                frame.process_write(ctx.as_mut())
            };
        }
        // frame.error holds the Modbus exception code (0 = none)
        frame.error as i32
    });
    r.unwrap_or(-4)
}

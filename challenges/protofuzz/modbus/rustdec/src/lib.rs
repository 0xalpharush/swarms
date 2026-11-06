use rmodbus::server::ModbusFrame;
use rmodbus::ModbusProto;
use std::slice;

// Decode a Modbus TCP ADU (MBAP + PDU) as a server would parse a request.
// Returns 0 if the frame parses to a known function with consistent framing,
// -1 on a parse/validation error. A panic (should not happen) becomes -4.
#[no_mangle]
pub extern "C" fn rmodbus_parse_tcp(inp: *const u8, inlen: usize) -> i32 {
    if inp.is_null() && inlen != 0 {
        return -2;
    }
    let input = unsafe { slice::from_raw_parts(inp, inlen) };
    // address the frame to its own unit id (TCP MBAP unit = byte 6); otherwise
    // rmodbus silently ignores frames not addressed to the configured unit and
    // returns Ok, which is not the same as "accepted a valid request".
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

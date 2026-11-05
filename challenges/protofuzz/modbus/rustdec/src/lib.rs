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
    let r = std::panic::catch_unwind(|| {
        let mut response: Vec<u8> = Vec::new();
        let mut frame = ModbusFrame::new(1, input, ModbusProto::TcpUdp, &mut response);
        match frame.parse() {
            Ok(()) => 0i32,
            Err(_) => -1i32,
        }
    });
    r.unwrap_or(-4)
}

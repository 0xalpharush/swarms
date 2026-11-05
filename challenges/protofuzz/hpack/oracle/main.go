package main

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"

	"golang.org/x/net/http2/hpack"
)

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 1<<20), 1<<24)
	for sc.Scan() {
		raw, err := hex.DecodeString(sc.Text())
		if err != nil {
			fmt.Println("ERR hex")
			continue
		}
		var out []byte
		bad := false
		dec := hpack.NewDecoder(4096, func(hf hpack.HeaderField) {
			var l [4]byte
			binary.LittleEndian.PutUint32(l[:], uint32(len(hf.Name)))
			out = append(out, l[:]...)
			out = append(out, hf.Name...)
			binary.LittleEndian.PutUint32(l[:], uint32(len(hf.Value)))
			out = append(out, l[:]...)
			out = append(out, hf.Value...)
		})
		if _, err := dec.Write(raw); err != nil {
			bad = true
		}
		if err := dec.Close(); err != nil {
			bad = true
		}
		if bad {
			fmt.Println("ERR decode")
		} else {
			fmt.Println("OK " + hex.EncodeToString(out))
		}
	}
}

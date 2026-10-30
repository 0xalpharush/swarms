const encoder = new TextEncoder()

async function key(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('swarms/seal/' + secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(secret: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, await key(secret), encoder.encode(plain)),
  )
  return btoa(String.fromCharCode(...iv, ...sealed))
}

export async function open(secret: string, sealed: string) {
  const bytes = Uint8Array.from(atob(sealed), (char) => char.charCodeAt(0))
  const plain = await crypto.subtle.decrypt(
    { iv: bytes.slice(0, 12), name: 'AES-GCM' },
    await key(secret),
    bytes.slice(12),
  )
  return new TextDecoder().decode(plain)
}

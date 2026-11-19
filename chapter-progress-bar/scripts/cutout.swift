// 白底素材抠透明底：从四边泛洪去掉相连的白底，只保留最大的一块前景（去掉周围的装饰点和线），裁到内容边框
// 用法: swift cutout.swift <输入图> <输出 png> [白底阈值，默认 225]
import AppKit
import Foundation

let a = CommandLine.arguments
let inURL = URL(fileURLWithPath: a[1]), outURL = URL(fileURLWithPath: a[2])
let thr = a.count > 3 ? Int(a[3])! : 225
guard let src = NSImage(contentsOf: inURL), let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("读不了", a[1]); exit(1) }
let W = cg.width, H = cg.height
var px = [UInt8](repeating: 0, count: W * H * 4)
let ctx = CGContext(data: &px, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))

// 白底，或已经透明的像素，都算背景（所以透明底 PNG 也能直接过一遍：只去掉周围散落的小块并裁边）
func isWhite(_ i: Int) -> Bool { let o = i * 4; if px[o+3] < 16 { return true }; return Int(px[o]) >= thr && Int(px[o+1]) >= thr && Int(px[o+2]) >= thr }
// 1. 从边缘泛洪，标记背景
var bg = [Bool](repeating: false, count: W * H)
var stack: [Int] = []
for x in 0..<W { stack.append(x); stack.append((H-1)*W + x) }
for y in 0..<H { stack.append(y*W); stack.append(y*W + W-1) }
while let i = stack.popLast() {
  if bg[i] || !isWhite(i) { continue }
  bg[i] = true
  let x = i % W, y = i / W
  if x > 0 { stack.append(i-1) }; if x < W-1 { stack.append(i+1) }
  if y > 0 { stack.append(i-W) }; if y < H-1 { stack.append(i+W) }
}
// 2. 前景连通块，只留最大的
var lab = [Int32](repeating: -1, count: W * H)
var sizes: [Int] = []
for s in 0..<(W*H) where !bg[s] && lab[s] < 0 {
  let id = Int32(sizes.count); var n = 0; stack = [s]; lab[s] = id
  while let i = stack.popLast() {
    n += 1
    let x = i % W, y = i / W
    for j in [x > 0 ? i-1 : -1, x < W-1 ? i+1 : -1, y > 0 ? i-W : -1, y < H-1 ? i+W : -1] where j >= 0 && !bg[j] && lab[j] < 0 { lab[j] = id; stack.append(j) }
  }
  sizes.append(n)
}
let keep = Int32(sizes.indices.max(by: { sizes[$0] < sizes[$1] })!)
// 3. 写 alpha，边缘一圈按亮度做柔边；求边框
var minX = W, minY = H, maxX = 0, maxY = 0
for i in 0..<(W*H) {
  let o = i * 4
  if lab[i] != keep { px[o] = 0; px[o+1] = 0; px[o+2] = 0; px[o+3] = 0; continue }
  let x = i % W, y = i / W
  minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
  var edge = false
  for j in [x > 0 ? i-1 : -1, x < W-1 ? i+1 : -1, y > 0 ? i-W : -1, y < H-1 ? i+W : -1] where j >= 0 && lab[j] != keep { edge = true }
  if edge {
    let lum = (Int(px[o]) + Int(px[o+1]) + Int(px[o+2])) / 3
    let al = max(0, min(255, (255 - lum) * 255 / max(1, 255 - thr + 40)))
    let f = Double(max(al, 90)) / 255
    px[o] = UInt8(Double(px[o]) * f); px[o+1] = UInt8(Double(px[o+1]) * f); px[o+2] = UInt8(Double(px[o+2]) * f); px[o+3] = UInt8(f * 255)
  }
}
let full = ctx.makeImage()!
let pad = 6
let crop = full.cropping(to: CGRect(x: max(0, minX-pad), y: max(0, minY-pad), width: min(W, maxX+pad) - max(0, minX-pad), height: min(H, maxY+pad) - max(0, minY-pad)))!
let rep = NSBitmapImageRep(cgImage: crop)
try! rep.representation(using: .png, properties: [:])!.write(to: outURL)
print(a[2], crop.width, "x", crop.height, "块数", sizes.count)

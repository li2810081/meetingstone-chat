#!/usr/bin/env python3
"""下载并裁切运行所需的魔兽 UI 贴图到 app/renderer/assets/。

贴图版权归 Blizzard Entertainment 所有（经 Gethe/wow-ui-textures 公开镜像获取），
ElvUI 图标版权归 tukui-org，集合石 Logo 版权归 MeetingStone 作者。
本脚本只负责在本地生成运行所需文件，不随仓库分发这些资源。

用法:
    python tools/prepare-assets.py            # 生成到 app/renderer/assets
    python tools/prepare-assets.py --check    # 只检查缺失的素材
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageOps, ImageDraw

WOW = "https://raw.githubusercontent.com/Gethe/wow-ui-textures/live/"
ELVUI = "https://raw.githubusercontent.com/tukui-org/ElvUI/main/ElvUI/Game/Shared/Media/Textures/"
MS = "https://raw.githubusercontent.com/jat001/MeetingStone_Happy/main/MeetingStone/Media/"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "app", "renderer", "assets"))

_cache: dict[str, Image.Image] = {}


def fetch(url: str) -> Image.Image:
    if url in _cache:
        return _cache[url]
    print("  fetch", url.rsplit("/", 1)[-1])
    fd, path = tempfile.mkstemp(suffix=os.path.splitext(url)[1])
    os.close(fd)
    try:
        subprocess.run(["curl", "-fsSL", "--retry", "3", url, "-o", path], check=True)
        img = Image.open(path).convert("RGBA")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    _cache[url] = img
    return img


def save(img: Image.Image, name: str) -> None:
    img.save(os.path.join(OUT, name))


def crop_uv(im: Image.Image, l: float, r: float, t: float, b: float) -> Image.Image:
    w, h = im.size
    box = (round(min(l, r) * w), round(min(t, b) * h), round(max(l, r) * w), round(max(t, b) * h))
    c = im.crop(box)
    if t > b:
        c = ImageOps.flip(c)
    if l > r:
        c = ImageOps.mirror(c)
    return c


def bbox(im: Image.Image) -> Image.Image:
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def nine_slice(src: Image.Image, dst: str) -> None:
    """UI-DialogBox-Border (256x32, 8 个 32x32 子块) → 96x96 九宫格。"""
    t = [src.crop((i * 32, 0, (i + 1) * 32, 32)) for i in range(8)]
    top = t[2].transpose(Image.TRANSPOSE)
    bot = t[3].transpose(Image.TRANSPOSE)
    nine = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    nine.paste(t[4], (0, 0)); nine.paste(top, (32, 0)); nine.paste(t[5], (64, 0))
    nine.paste(t[0], (0, 32)); nine.paste(t[1], (64, 32))
    nine.paste(t[6], (0, 64)); nine.paste(bot, (32, 64)); nine.paste(t[7], (64, 64))
    save(nine, dst)


def main(check_only: bool = False) -> None:
    os.makedirs(OUT, exist_ok=True)

    print("[1/7] FrameGeneral（主窗体外壳）")
    uif = fetch(WOW + "FrameGeneral/UI-Frame.PNG")
    _uif = fetch(WOW + "FrameGeneral/_UI-Frame.PNG")
    buif = fetch(WOW + "FrameGeneral/!UI-Frame.PNG")
    save(bbox(crop_uv(buif, 0.171875, 0.328125, 0, 1)), "nf-frame-right-tile.png")
    save(bbox(crop_uv(buif, 0.359375, 0.609375, 0, 1)), "nf-frame-left-tile.png")
    save(bbox(crop_uv(buif, 0.015625, 0.0625, 0, 1)), "nf-inset-right-tile.png")
    save(bbox(crop_uv(buif, 0.09375, 0.140625, 0, 1)), "nf-inset-left-tile.png")
    save(bbox(crop_uv(_uif, 0, 1, 0.203125, 0.2734375)), "nf-frame-bot-tile.png")
    save(bbox(crop_uv(_uif, 0, 1, 0.0859375, 0.109375)), "nf-inset-top-tile.png")
    save(bbox(crop_uv(_uif, 0, 1, 0.0078125, 0.03125)), "nf-inset-bot-tile.png")
    save(bbox(crop_uv(_uif, 0, 1, 0.2890625, 0.421875)), "nf-frame-title-bg.png")
    save(bbox(crop_uv(_uif, 0, 1, 0.4375, 0.65625)), "nf-frame-title-tile.png")
    save(bbox(crop_uv(_uif, 0, 1, 0.671875, 0.9609375)), "nf-frame-top-streaks.png")
    save(bbox(crop_uv(uif, 0.6328125, 0.890625, 0.0078125, 0.265625)), "nf-frame-top-right.png")
    save(bbox(crop_uv(uif, 0.6328125, 0.6796875, 0.546875, 0.59375)), "nf-inset-tl.png")
    save(bbox(crop_uv(uif, 0.90625, 0.953125, 0.21875, 0.265625)), "nf-inset-tr.png")
    save(bbox(crop_uv(uif, 0.6953125, 0.7421875, 0.546875, 0.59375)), "nf-inset-bl.png")
    save(bbox(crop_uv(uif, 0.7578125, 0.8046875, 0.546875, 0.59375)), "nf-inset-br.png")
    save(bbox(crop_uv(uif, 0.0078125, 0.1171875, 0.6328125, 0.7421875)), "nf-frame-bot-left.png")
    save(bbox(crop_uv(uif, 0.1328125, 0.21875, 0.8984375, 0.984375)), "nf-frame-bot-right.png")

    print("[2/7] 对话框（TitlePanel 9-slice / 标题横幅 / 关闭钮）")
    nine_slice(fetch(WOW + "DialogFrame/UI-DialogBox-Border.PNG"), "wow-dialog-9slice-silver.png")
    nine_slice(fetch(WOW + "DialogFrame/UI-DialogBox-Gold-Border.PNG"), "wow-dialog-9slice-gold.png")
    save(fetch(WOW + "DialogFrame/UI-DialogBox-Background-Dark.PNG"), "fg-UI-DialogBox-Background-Dark.PNG")
    save(bbox(fetch(WOW + "DialogFrame/UI-DialogBox-Header.PNG")), "nf-header.png")
    save(bbox(fetch(WOW + "DialogFrame/UI-DialogBox-Gold-Header.PNG")), "nf-header-gold.png")
    save(bbox(fetch(WOW + "Buttons/UI-Panel-MinimizeButton-Up.PNG")), "nf-close-up.png")
    save(bbox(fetch(WOW + "Buttons/UI-Panel-MinimizeButton-Down.PNG")), "nf-close-down.png")

    print("[3/7] 桌面底纹（岩石 / 大理石）")
    save(fetch(WOW + "FrameGeneral/UI-Background-Rock.PNG"), "fg-UI-Background-Rock.PNG")
    save(fetch(WOW + "FrameGeneral/UI-Background-Marble.PNG"), "fg-UI-Background-Marble.PNG")

    print("[4/7] 面板按钮（三段式）")
    for st, name in [("Up", ""), ("Down", "-down"), ("Disabled", "-disabled")]:
        im = fetch(WOW + "Buttons/UI-Panel-Button-%s.PNG" % st)
        save(im.crop((0, 0, 12, 22)), "nf-panel-btn-left%s.png" % name)
        save(im.crop((12, 0, 68, 22)), "nf-panel-btn-mid%s.png" % name)
        save(im.crop((68, 0, 80, 22)), "nf-panel-btn-right%s.png" % name)
        if st == "Up":
            save(im.crop((0, 0, 12, 22)), "nf-panel-btn-left.png")
            save(im.crop((12, 0, 68, 22)), "nf-panel-btn-mid.png")
            save(im.crop((68, 0, 80, 22)), "nf-panel-btn-right.png")

    print("[5/7] 聊天框（页签 / 图标 / 输入框 / 拍卖行条目）")
    act = fetch(WOW + "CHATFRAME/ChatFrameTab-BGLeft.PNG")
    mid = fetch(WOW + "CHATFRAME/ChatFrameTab-BGMid.PNG")
    right = fetch(WOW + "CHATFRAME/ChatFrameTab-BGRight.PNG")
    save(bbox(act), "cf-tab-bg-left.png")
    save(bbox(mid), "cf-tab-bg-mid.png")
    save(bbox(right), "cf-tab-bg-right.png")
    for src, dst in [
        ("UI-ChatIcon-Chat-Up.PNG", "cf-ico-chat.png"),
        ("UI-ChatIcon-ScrollUp-Up.PNG", "cf-ico-up.png"),
        ("UI-ChatIcon-ScrollDown-Up.PNG", "cf-ico-down.png"),
        ("UI-ChatIcon-ScrollEnd-Up.PNG", "cf-ico-end.png"),
    ]:
        save(bbox(fetch(WOW + "CHATFRAME/" + src)), dst)
    save(fetch(WOW + "CHATFRAME/UI-CHATINPUTBORDER-LEFT.PNG"), "cf-UI-CHATINPUTBORDER-LEFT.PNG")
    save(fetch(WOW + "CHATFRAME/UI-CHATINPUTBORDER-RIGHT.PNG"), "cf-UI-CHATINPUTBORDER-RIGHT.PNG")

    auc = fetch(WOW + "AUCTIONFRAME/UI-AuctionItemNameFrame.PNG")
    save(auc.crop((0, 0, 10, 32)), "nf-auction-left.png")
    save(auc.crop((10, 0, 96, 32)), "nf-auction-mid.png")
    save(auc.crop((96, 0, 106, 32)), "nf-auction-right.png")

    print("[6/7] 页签（凹槽内页签 / 底部悬挂页签）")
    hact = fetch(WOW + "HELPFRAME/HelpFrameTab-Active.PNG")
    hin = fetch(WOW + "HELPFRAME/HelpFrameTab-Inactive.PNG")
    for st, im in [("active", hact), ("inactive", hin)]:
        save(im.crop((0, 0, 16, 32)), "nf-intab-%s-left.png" % st)
        save(im.crop((16, 0, 48, 32)), "nf-intab-%s-mid.png" % st)
        save(im.crop((48, 0, 64, 32)), "nf-intab-%s-right.png" % st)
    b_act = fetch(WOW + "PaperDollInfoFrame/UI-CHARACTER-ACTIVETAB.PNG")
    b_in = fetch(WOW + "PaperDollInfoFrame/UI-CHARACTER-INACTIVETAB.PNG")
    save(bbox(b_act.crop((6, 0, 20, 35))), "nf-bottab-active-left.png")
    save(bbox(b_act.crop((20, 0, 108, 35))), "nf-bottab-active-mid.png")
    save(bbox(b_act.crop((108, 0, 122, 35))), "nf-bottab-active-right.png")
    save(bbox(b_in.crop((6, 0, 20, 32))), "nf-bottab-inactive-left.png")
    save(bbox(b_in.crop((20, 0, 108, 32))), "nf-bottab-inactive-mid.png")
    save(bbox(b_in.crop((108, 0, 122, 32))), "nf-bottab-inactive-right.png")

    print("[7/7] ElvUI 职责图标 + 集合石肖像")
    for name in ["Tank", "DPS", "Healer"]:
        im = fetch(ELVUI + name + ".tga")
        save(im, "eui-" + name.lower() + ".png")
    ring = crop_uv(uif, 0.0078125, 0.6171875, 0.0078125, 0.6171875)  # 78x78 肖像环
    logo = fetch(MS + "Logo.blp").resize((60, 60), Image.LANCZOS)
    mask = Image.new("L", (60, 60), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, 58, 58), fill=255)
    badge = Image.new("RGBA", (78, 78), (0, 0, 0, 0))
    badge.paste(logo, (8, 4), mask)
    badge.alpha_composite(ring, (0, 0))
    save(badge, "nf-portrait-badge.png")

    # 校验
    html = open(os.path.join(HERE, "..", "app", "renderer", "index.html"), encoding="utf-8").read()
    import re
    refs = set(re.findall(r"assets/([A-Za-z0-9_.-]+\.(?:png|PNG))", html))
    # JS 拼接的动态页签名
    for kind in ("bottab", "intab"):
        for st in ("active", "inactive"):
            for part in ("left", "mid", "right"):
                refs.add("nf-%s-%s-%s.png" % (kind, st, part))
    missing = sorted(r for r in refs if not os.path.exists(os.path.join(OUT, r)))
    print("\n生成完成：%d 个文件 → %s" % (len(os.listdir(OUT)), OUT))
    if missing:
        print("缺少：", ", ".join(missing))
        sys.exit(1)
    print("全部引用素材已就绪。")


if __name__ == "__main__":
    main("--check" in sys.argv)

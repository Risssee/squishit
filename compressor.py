from PIL import Image, ImageOps
import io

# ─────────────────────────────────────────────
# CÁC ĐỊNH DẠNG ĐƯỢC HỖ TRỢ
# ─────────────────────────────────────────────
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}


def allowed_file(filename):
    """Kiểm tra file có đúng định dạng không"""
    if "." not in filename:
        return False
    ext = filename.rsplit(".", 1)[-1].lower()
    return ext in ALLOWED_EXTENSIONS


# ─────────────────────────────────────────────
# KỸ THUẬT 1: XỬ LÝ TRANSPARENCY
# ─────────────────────────────────────────────
def handle_transparency(img, bg_color=(255, 255, 255)):
    """
    Flatten alpha channel xuống nền màu trắng.
    Chỉ dùng khi xuất ra JPEG vì JPEG không hỗ trợ transparency.
    """
    if img.mode == "P":
        img = img.convert("RGBA")
    if img.mode in ("RGBA", "LA"):
        background = Image.new("RGB", img.size, bg_color)
        background.paste(img, mask=img.split()[-1])
        return background
    return img.convert("RGB") if img.mode != "RGB" else img


# ─────────────────────────────────────────────
# KỸ THUẬT 2: STRIP METADATA
# Encode/decode qua BytesIO mà không truyền EXIF/pnginfo
# → giữ nguyên pixel data, không phá vỡ khả năng nén.
# ─────────────────────────────────────────────
def strip_metadata(img):
    """Xóa toàn bộ metadata bằng cách save/reload không kèm info."""
    buf = io.BytesIO()
    fmt = img.format or "PNG"
    save_kwargs = {"format": fmt}
    if fmt == "JPEG":
        save_kwargs["quality"] = 95
    elif fmt == "PNG":
        save_kwargs["compress_level"] = 6
    img.save(buf, **save_kwargs)
    buf.seek(0)
    clean = Image.open(buf)
    clean.load()
    return clean


# ─────────────────────────────────────────────
# KỸ THUẬT 3: RESIZE THEO TỈ LỆ PHẦN TRĂM
# Khác với bản gốc dùng max_width/max_height,
# bản này nhận scale (0.1 → 1.0) để resize đồng đều.
# ─────────────────────────────────────────────
def resize_by_scale(img, scale):
    """
    Thu nhỏ ảnh theo tỉ lệ scale (0.1 → 1.0).
    scale = 1.0 nghĩa là giữ nguyên kích thước.
    """
    if scale >= 1.0:
        return img
    new_w = max(1, int(img.width * scale))
    new_h = max(1, int(img.height * scale))
    return img.resize((new_w, new_h), Image.LANCZOS)


# ─────────────────────────────────────────────
# HÀM CHÍNH
# ─────────────────────────────────────────────
def compress_image(
    file,
    quality=80,             # Chất lượng JPEG/WebP (1–100)
    resize_scale=1.0,       # Tỉ lệ resize (0.1–1.0), 1.0 = không resize
    output_format=None,     # None = giữ nguyên | "JPEG" | "PNG" | "WEBP"
    strip_meta=True,        # Xóa EXIF/metadata
    png_compress_level=9,   # Mức nén PNG (0–9)
    original_size=None,     # Dung lượng gốc để safety guard
):
    # ── Mở ảnh ──────────────────────────────
    try:
        img = Image.open(file)
    except Exception:
        raise ValueError("File ảnh không hợp lệ hoặc bị lỗi")

    src_fmt = (img.format or "JPEG").upper()

    # ── Auto-rotate theo EXIF ────────────────
    img = ImageOps.exif_transpose(img)

    # ── Strip Metadata ───────────────────────
    if strip_meta:
        img = strip_metadata(img)

    # ── Resize theo scale ────────────────────
    img = resize_by_scale(img, resize_scale)

    # ── Xác định format xuất ─────────────────
    fmt = (output_format or src_fmt).upper()
    if fmt == "JPG":
        fmt = "JPEG"
    if fmt not in ("JPEG", "PNG", "WEBP"):
        raise ValueError(f"Định dạng không hỗ trợ: {fmt}")

    # ── Ghi ảnh ra RAM ────────────────────────
    output = io.BytesIO()

    if fmt == "JPEG":
        img = handle_transparency(img)
        img.save(output, format="JPEG", quality=quality,
                 optimize=True)

    elif fmt == "PNG":
        if img.mode == "P":
            img = img.convert("RGBA")
        img.save(output, format="PNG", optimize=True,
                 compress_level=png_compress_level)

    elif fmt == "WEBP":
        img.save(output, format="WEBP", quality=quality, method=6)

    output.seek(0)
    compressed_size = len(output.getvalue())

    # ── Safety guard ──────────────────────────────────────────────────────
    # Đây là tool GIẢM dung lượng — nếu output to hơn gốc thì trả gốc luôn.
    # Áp dụng với mọi trường hợp, kể cả khi đổi format (PNG → WebP, v.v.)
    if original_size is not None and compressed_size > original_size:
        file.seek(0)
        original_bytes = file.read()
        fallback = io.BytesIO(original_bytes)
        fallback.seek(0)
        # Trả src_fmt (format gốc) vì file trả về chính là file gốc
        return fallback, src_fmt, original_size, original_size

    return output, fmt, None, None
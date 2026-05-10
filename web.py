import sys
import os
import io

# Thêm thư mục gốc vào sys.path để import compressor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, render_template, request, send_file, jsonify
from compressor import compress_image, allowed_file  # type: ignore

# ─────────────────────────────────────────────
# KHỞI TẠO FLASK
# ─────────────────────────────────────────────
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # Giới hạn 20MB


# ─────────────────────────────────────────────
# ROUTE: Trang chủ
# ─────────────────────────────────────────────
@app.route("/")
def home():
    return render_template("index.html")


# ─────────────────────────────────────────────
# ROUTE: Nén ảnh
# ─────────────────────────────────────────────
@app.route("/compress", methods=["POST"])
def compress():

    if "image" not in request.files:
        return jsonify({"error": "Chưa có file ảnh"}), 400

    file = request.files["image"]

    if not file.filename:
        return jsonify({"error": "Tên file không hợp lệ"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Chỉ hỗ trợ định dạng: JPG, PNG, WebP"}), 400

    # ── Lấy tham số từ form ──────────────────
    try:
        quality = int(request.form.get("quality", 80))
        quality = max(1, min(100, quality))
    except ValueError:
        quality = 80

    try:
        # resize_scale: 10–100 từ slider, chia 100 → float 0.1–1.0
        resize_scale = float(request.form.get("resize_scale", 100)) / 100
        resize_scale = max(0.1, min(1.0, resize_scale))
    except ValueError:
        resize_scale = 1.0

    try:
        png_compress_level = int(request.form.get("png_compress_level", 9))
        png_compress_level = max(0, min(9, png_compress_level))
    except ValueError:
        png_compress_level = 9

    output_format = request.form.get("output_format") or None
    strip_meta    = request.form.get("strip_meta", "true").lower() == "true"

    # ── Tính dung lượng gốc ─────────────────
    original_size = len(file.read())
    file.seek(0)

    # ── Gọi compressor ───────────────────────
    try:
        output, fmt, _orig, _opt = compress_image(
            file,
            quality=quality,
            resize_scale=resize_scale,
            output_format=output_format,
            strip_meta=strip_meta,
            png_compress_level=png_compress_level,
            original_size=original_size,
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Lỗi xử lý ảnh: {str(e)}"}), 500

    optimized_size = len(output.getvalue())
    output.seek(0)

    # ── Chuẩn bị response ───────────────────
    mime_map = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
    ext_map  = {"JPEG": "jpg",        "PNG": "png",       "WEBP": "webp"}

    original_name = file.filename.rsplit(".", 1)[0]
    download_name = f"{original_name}_compressed.{ext_map[fmt]}"

    response = send_file(
        output,
        mimetype=mime_map[fmt],
        as_attachment=True,
        download_name=download_name,
    )

    # Gửi kích thước qua header để JS đọc
    response.headers["X-Original-Size"]  = str(original_size)
    response.headers["X-Optimized-Size"] = str(optimized_size)
    response.headers["Access-Control-Expose-Headers"] = "X-Original-Size, X-Optimized-Size"

    return response


# ─────────────────────────────────────────────
# CHẠY SERVER
# ─────────────────────────────────────────────
if __name__ == "__main__":
   app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
/* ═══════════════════════════════════════════════
   SQUISHIT — SCRIPT.JS
   Flow:
   1. Chọn / kéo thả ảnh → hiện preview gốc + thông tin
   2. Chọn các kỹ thuật nén (toggle, slider)
   3. Nhấn "Tối ưu ảnh" → gọi /compress → hiện kết quả
   4. Tải về hoặc reset
═══════════════════════════════════════════════ */


/* ── 1. DOM REFERENCES ──────────────────────── */
const dropZone        = document.getElementById("dropZone");
const fileInput       = document.getElementById("fileInput");
const workspace       = document.getElementById("workspace");
const resultBar       = document.getElementById("resultBar");
const loadingOverlay  = document.getElementById("loadingOverlay");
const errorToast      = document.getElementById("errorToast");

// Preview
const imgOriginal     = document.getElementById("imgOriginal");
const imgCompressed   = document.getElementById("imgCompressed");
const previewEmpty    = document.getElementById("previewEmpty");
const metaOriginal    = document.getElementById("metaOriginal");
const metaCompressed  = document.getElementById("metaCompressed");

// Controls — toggles
const stripMetaToggle = document.getElementById("stripMeta");
const pngOptimize     = document.getElementById("pngOptimize");

// Controls — sliders
const resizeSlider    = document.getElementById("resizeScale");
const resizeDisplay   = document.getElementById("resizeDisplay");
const qualitySlider   = document.getElementById("quality");
const qualityDisplay  = document.getElementById("qualityDisplay");
const fmtButtons      = document.querySelectorAll(".fmt-btn");

// Actions
const btnCompress     = document.getElementById("btnCompress");
const btnReset        = document.getElementById("btnReset");
const btnDownload     = document.getElementById("btnDownload");

// Stats
const statOriginal    = document.getElementById("statOriginal");
const statCompressed  = document.getElementById("statCompressed");
const statSaved       = document.getElementById("statSaved");


/* ── 2. STATE ───────────────────────────────── */
let currentFile    = null;   // File object đang chọn
let selectedFormat = "";     // "" | "JPEG" | "PNG" | "WEBP"
let toastTimeout   = null;


/* ── 3. FILE SELECTION ──────────────────────── */

// Click vào drop zone → mở dialog (bỏ qua khi click label .btn-browse)
dropZone.addEventListener("click", (e) => {
  if (e.target.closest(".btn-browse")) return;
  fileInput.click();
});

// Phím Enter / Space trên drop zone
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

// Chọn file qua input dialog
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
});

// Drag & Drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", (e) => {
  if (!dropZone.contains(e.relatedTarget))
    dropZone.classList.remove("drag-over");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

/**
 * Validate và load file được chọn.
 */
function handleFile(file) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    showToast("Chỉ hỗ trợ JPG, PNG, WebP");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast("File quá lớn! Tối đa 20MB");
    return;
  }
  currentFile = file;
  loadPreview(file);
  showWorkspace();
}


/* ── 4. PREVIEW ẢNH GỐC ────────────────────── */

/**
 * Hiện ảnh gốc và thông tin (định dạng + kích thước px + dung lượng).
 * Reset phần kết quả về trạng thái ban đầu.
 */
function loadPreview(file) {
  const url = URL.createObjectURL(file);
  imgOriginal.src = url;

  // Lấy định dạng từ MIME type (image/jpeg → JPG)
  const fmt = file.type.split("/")[1]?.toUpperCase().replace("JPEG", "JPG") || "?";
  metaOriginal.textContent = formatSize(file.size);

  // Lấy kích thước pixel sau khi ảnh load xong, ghép luôn định dạng vào
  imgOriginal.onload = () => {
    metaOriginal.textContent =
      `${fmt} · ${imgOriginal.naturalWidth} × ${imgOriginal.naturalHeight}px · ${formatSize(file.size)}`;
    URL.revokeObjectURL(url);
  };

  // Reset preview ảnh nén
  imgCompressed.style.display = "none";
  imgCompressed.src = "";
  previewEmpty.style.display = "flex";
  metaCompressed.textContent = "—";

  // Ẩn result bar cũ
  resultBar.setAttribute("aria-hidden", "true");
}


/* ── 5. CONTROLS: cập nhật giá trị hiển thị ── */

resizeSlider.addEventListener("input",  () => resizeDisplay.textContent  = resizeSlider.value + "%");
qualitySlider.addEventListener("input", () => qualityDisplay.textContent = qualitySlider.value);

// Format buttons — chỉ một nút được active tại một thời điểm
fmtButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    fmtButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedFormat = btn.dataset.fmt;
  });
});


/* ── 6. NÉN ẢNH ────────────────────────────── */

btnCompress.addEventListener("click", async () => {
  if (!currentFile) { showToast("Hãy chọn ảnh trước!"); return; }

  showLoading(true);
  btnCompress.disabled = true;

  // Đóng gói FormData với tất cả tham số
  const formData = new FormData();
  formData.append("image",              currentFile);
  formData.append("strip_meta",         stripMetaToggle.checked.toString());
  formData.append("resize_scale",       resizeSlider.value);              // 10–100, server chia 100
  formData.append("quality",            qualitySlider.value);             // 1–100
  formData.append("png_compress_level", pngOptimize.checked ? 9 : 0);    // bật → mức tối đa, tắt → không nén
  formData.append("output_format",      selectedFormat);                  // "" | "JPEG" | "PNG" | "WEBP"

  try {
    const response = await fetch("/compress", { method: "POST", body: formData });

    if (!response.ok) {
      let errMsg = "Có lỗi xảy ra khi nén ảnh";
      try { const d = await response.json(); errMsg = d.error || errMsg; } catch (_) {}
      throw new Error(errMsg);
    }

    // Đọc kích thước file từ custom headers
    const originalSize  = parseInt(response.headers.get("X-Original-Size")  || "0");
    const optimizedSize = parseInt(response.headers.get("X-Optimized-Size") || "0");

    // Đọc blob ảnh đã nén
    const blob = await response.blob();

    showCompressedPreview(blob, optimizedSize);
    showResult(originalSize, optimizedSize, blob);

  } catch (err) {
    showToast(err.message || "Lỗi không xác định");
  } finally {
    showLoading(false);
    btnCompress.disabled = false;
  }
});


/* ── 7. RESULT ──────────────────────────────── */

/**
 * Hiện ảnh đã nén vào preview box bên phải.
 */
function showCompressedPreview(blob, optimizedSize) {
  const url = URL.createObjectURL(blob);
  imgCompressed.onload = () => {
    metaCompressed.textContent =
      `${imgCompressed.naturalWidth} × ${imgCompressed.naturalHeight}px · ${formatSize(optimizedSize)}`;
    URL.revokeObjectURL(url);
  };
  imgCompressed.src = url;
  imgCompressed.style.display = "block";
  previewEmpty.style.display  = "none";
}

/**
 * Điền thống kê vào result bar và gán href tải về.
 */
function showResult(originalSize, optimizedSize, blob) {
  const saved = originalSize - optimizedSize;
  const pct   = originalSize > 0 ? ((saved / originalSize) * 100).toFixed(1) : 0;

  statOriginal.textContent   = formatSize(originalSize);
  statCompressed.textContent = formatSize(optimizedSize);

  if (saved >= 0) {
    statSaved.textContent = `${formatSize(saved)} (${pct}%)`;
    statSaved.style.color = "var(--accent)";
  } else {
    statSaved.textContent = `+${formatSize(Math.abs(saved))}`;
    statSaved.style.color = "var(--error)";
  }

  // Gán nút tải về
  const baseName = currentFile.name.replace(/\.[^.]+$/, "");
  const ext      = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  btnDownload.href     = URL.createObjectURL(blob);
  btnDownload.download = `${baseName}_compressed.${ext}`;

  resultBar.setAttribute("aria-hidden", "false");
}


/* ── 8. RESET ───────────────────────────────── */

btnReset.addEventListener("click", resetAll);

function resetAll() {
  currentFile    = null;
  selectedFormat = "";
  fileInput.value = "";

  // Reset preview
  imgOriginal.src           = "";
  imgCompressed.src         = "";
  imgCompressed.style.display = "none";
  previewEmpty.style.display  = "flex";
  metaOriginal.textContent    = "—";
  metaCompressed.textContent  = "—";

  // Reset controls về mặc định
  stripMetaToggle.checked    = true;
  pngOptimize.checked        = true;
  resizeSlider.value         = 100; resizeDisplay.textContent  = "100%";
  qualitySlider.value        = 80;  qualityDisplay.textContent = "80";
  fmtButtons.forEach((b) => b.classList.remove("active"));
  fmtButtons[0].classList.add("active");

  // Ẩn workspace + result, hiện drop zone
  hideWorkspace();
  resultBar.setAttribute("aria-hidden", "true");
}


/* ── 9. HELPERS ─────────────────────────────── */

function showWorkspace() {
  dropZone.style.display = "none";
  workspace.setAttribute("aria-hidden", "false");
  workspace.style.display = "flex";
}

function hideWorkspace() {
  workspace.setAttribute("aria-hidden", "true");
  workspace.style.display = "";
  dropZone.style.display  = "";
}

function showLoading(visible) {
  loadingOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
}

function showToast(message) {
  errorToast.textContent = message;
  errorToast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => errorToast.classList.remove("show"), 3500);
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
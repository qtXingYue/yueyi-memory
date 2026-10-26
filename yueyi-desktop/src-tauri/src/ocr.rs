// ============ WinRT 本地 OCR（Windows.Media.Ocr，无需联网） ============
#![cfg(windows)]

use windows::Graphics::Imaging::BitmapDecoder;
use windows::Media::Ocr::OcrEngine;

/// 对一张本地图片做 OCR（通过内存流直接解码，彻底避免 WinRT StorageFile 对非打包桌面路径报错 0x80070005）
pub fn ocr_image_file(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取图片文件失败: {}", e))?;
    ocr_image_bytes(&bytes)
}

/// 对内存图片字节（PNG / JPG / BMP）执行 WinRT OCR
pub fn ocr_image_bytes(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }
    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        );

        use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

        let stream = InMemoryRandomAccessStream::new()
            .map_err(|e| format!("创建内存流失败: {}", e))?;

        let writer = DataWriter::CreateDataWriter(&stream)
            .map_err(|e| format!("创建 DataWriter 失败: {}", e))?;
        writer.WriteBytes(bytes).map_err(|e| format!("写入数据失败: {}", e))?;
        writer.StoreAsync()
            .map_err(|e| format!("StoreAsync 启动失败: {}", e))?
            .get()
            .map_err(|e| format!("StoreAsync 执行失败: {}", e))?;
        let _ = writer.DetachStream();

        stream.Seek(0).map_err(|e| format!("Seek 失败: {}", e))?;

        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(|e| format!("图像解码失败: {}", e))?
            .get()
            .map_err(|e| format!("图像解码失败: {}", e))?;

        let bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|e| format!("位图转换失败: {}", e))?
            .get()
            .map_err(|e| format!("位图转换失败: {}", e))?;

        recognize(&bitmap)
    }
}

/// 对已完成解码的 SoftwareBitmap 执行 OCR
#[allow(dead_code)]
pub fn recognize(bitmap: &windows::Graphics::Imaging::SoftwareBitmap) -> Result<String, String> {
    {
        // OCR 引擎（跟随系统语言）
        let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
            Ok(e) => e,
            Err(_) => {
                return Err(
                    "系统无可用 OCR 语言包（Windows 设置 → 时间和语言 → 语言 → 添加中文语言包）"
                        .into(),
                )
            }
        };

        let result = engine
            .RecognizeAsync(bitmap)
            .map_err(|e| format!("RecognizeAsync 启动失败: {}", e))?
            .get()
            .map_err(|e| format!("OCR 执行失败: {}", e))?;

        let text = result
            .Text()
            .map_err(|e| format!("读取 OCR 结果失败: {}", e))?
            .to_string();

        Ok(text.trim().to_string())
    }
}

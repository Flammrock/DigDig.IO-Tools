#[tauri::command]
pub(crate) fn window_opacity_supported() -> bool {
    cfg!(windows)
}

fn opacity_alpha(opacity: f64) -> Result<u8, String> {
    if !opacity.is_finite() || !(0.2..=1.0).contains(&opacity) {
        return Err("Choose a window opacity between 20% and 100%.".into());
    }
    Ok((opacity * 255.0).round() as u8)
}

#[tauri::command]
pub(crate) async fn set_window_opacity(
    window: tauri::WebviewWindow,
    opacity: f64,
) -> Result<(), String> {
    let alpha = opacity_alpha(opacity)?;
    #[cfg(windows)]
    {
        // A command can arrive off the UI thread. Await the result without
        // blocking that thread, including when called repeatedly by the slider.
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let result = target
                    .hwnd()
                    .map_err(|error| format!("Could not access the desktop window: {error}"))
                    .and_then(|hwnd| apply_alpha(hwnd.0, alpha));
                let _ = sender.send(result);
            })
            .map_err(|error| format!("Could not change window opacity: {error}"))?;
        receiver.await.map_err(|_| {
            "The desktop window closed before its opacity could be changed.".to_string()
        })?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, alpha);
        Err("Whole-window opacity is supported by the Windows desktop app.".into())
    }
}

#[cfg(windows)]
fn apply_alpha(hwnd: windows_sys::Win32::Foundation::HWND, alpha: u8) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, SetLastError, ERROR_SUCCESS},
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            LWA_ALPHA, WS_EX_LAYERED,
        },
    };

    // SAFETY: hwnd comes from the live Tauri window and all these operations run
    // on its UI thread. Only this app's top-level window style/alpha is changed.
    unsafe {
        SetLastError(ERROR_SUCCESS);
        let original_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as isize;
        if original_style == 0 && GetLastError() != ERROR_SUCCESS {
            return Err(format!(
                "Could not read the desktop window style: {}",
                std::io::Error::last_os_error()
            ));
        }
        let layered_style = original_style | WS_EX_LAYERED as isize;
        let needs_layering = original_style != layered_style;
        // Leave a normally opaque window on its existing rendering path.
        if alpha == 255 && needs_layering {
            return Ok(());
        }
        if needs_layering {
            SetLastError(ERROR_SUCCESS);
            if SetWindowLongPtrW(hwnd, GWL_EXSTYLE, layered_style as _) == 0
                && GetLastError() != ERROR_SUCCESS
            {
                return Err(format!(
                    "Could not enable window opacity: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        // LWA_ALPHA blends the complete window, including its frame and WebView.
        // Do not set WS_EX_TRANSPARENT: the window must remain interactive.
        if SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) == 0 {
            let error = std::io::Error::last_os_error();
            if needs_layering {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, original_style as _);
            }
            return Err(format!("Could not change window opacity: {error}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::opacity_alpha;

    #[test]
    fn opacity_accepts_boundaries_and_rounds_to_windows_alpha() {
        assert_eq!(opacity_alpha(0.2).unwrap(), 51);
        assert_eq!(opacity_alpha(0.5).unwrap(), 128);
        assert_eq!(opacity_alpha(1.0).unwrap(), 255);
    }

    #[test]
    fn opacity_rejects_non_finite_and_out_of_range_values() {
        for invalid in [
            f64::NAN,
            f64::NEG_INFINITY,
            f64::INFINITY,
            -1.0,
            0.0,
            0.199,
            1.001,
        ] {
            assert!(opacity_alpha(invalid).is_err());
        }
    }
}

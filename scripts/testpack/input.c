// 入力テスト：画面をなぞると線が描かれ、押したキーと入力した文字が表示される
#include <windows.h>
#include <wchar.h>

static POINT pts[20000];
static int npts = 0;
static wchar_t keys[200] = L"";
static wchar_t text[200] = L"";
static int clicks = 0;

static void keyname(UINT vk, wchar_t *out) {
  switch (vk) {
    case VK_LEFT: wcscpy(out, L"←"); return;
    case VK_RIGHT: wcscpy(out, L"→"); return;
    case VK_UP: wcscpy(out, L"↑"); return;
    case VK_DOWN: wcscpy(out, L"↓"); return;
    case VK_RETURN: wcscpy(out, L"Enter"); return;
    case VK_ESCAPE: wcscpy(out, L"Esc"); return;
    case VK_SPACE: wcscpy(out, L"Space"); return;
    case VK_SHIFT: wcscpy(out, L"Shift"); return;
    case VK_CONTROL: wcscpy(out, L"Ctrl"); return;
    case VK_MENU: wcscpy(out, L"Alt"); return;
    case VK_TAB: wcscpy(out, L"Tab"); return;
    case VK_BACK: wcscpy(out, L"BS"); return;
  }
  if (vk >= VK_F1 && vk <= VK_F12) { swprintf(out, 8, L"F%u", vk - VK_F1 + 1); return; }
  if ((vk >= '0' && vk <= '9') || (vk >= 'A' && vk <= 'Z')) { out[0] = (wchar_t)vk; out[1] = 0; return; }
  swprintf(out, 8, L"#%u", vk);
}

static LRESULT CALLBACK wp(HWND hw, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
  case WM_LBUTTONDOWN:
    clicks++;
    SetCapture(hw);
    if (npts < 20000) { pts[npts].x = -1; pts[npts++].y = -1; }
    /* fall through */
  case WM_MOUSEMOVE:
    if ((w & MK_LBUTTON) && npts < 20000) { pts[npts].x = (short)LOWORD(l); pts[npts++].y = (short)HIWORD(l); InvalidateRect(hw, NULL, FALSE); }
    return 0;
  case WM_LBUTTONUP: ReleaseCapture(); InvalidateRect(hw, NULL, FALSE); return 0;
  case WM_KEYDOWN: {
    wchar_t k[16]; keyname((UINT)w, k);
    if (wcslen(keys) > 150) wmemmove(keys, keys + 60, wcslen(keys + 60) + 1);
    wcscat(keys, k); wcscat(keys, L" ");
    InvalidateRect(hw, NULL, FALSE); return 0;
  }
  case WM_CHAR:
    if (w >= 32) {
      size_t n = wcslen(text);
      if (n > 150) { wmemmove(text, text + 60, n - 59); n = wcslen(text); }
      text[n] = (wchar_t)w; text[n + 1] = 0;
      InvalidateRect(hw, NULL, FALSE);
    }
    return 0;
  case WM_PAINT: {
    PAINTSTRUCT ps; HDC dc = BeginPaint(hw, &ps);
    RECT r; GetClientRect(hw, &r);
    HDC mem = CreateCompatibleDC(dc);
    HBITMAP bmp = CreateCompatibleBitmap(dc, r.right, r.bottom);
    SelectObject(mem, bmp);
    HBRUSH bg = CreateSolidBrush(RGB(250, 250, 245)); FillRect(mem, &r, bg); DeleteObject(bg);
    HFONT f = CreateFontW(17, 0, 0, 0, 400, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, L"MS UI Gothic");
    SelectObject(mem, f); SetBkMode(mem, TRANSPARENT); SetTextColor(mem, RGB(20, 20, 20));
    wchar_t line[300];
    TextOutW(mem, 10, 8, L"入力テスト：画面をなぞる・キーを押す・文字を入力する", 26);
    swprintf(line, 300, L"クリック回数: %d", clicks); TextOutW(mem, 10, 32, line, wcslen(line));
    swprintf(line, 300, L"押したキー: %ls", keys); TextOutW(mem, 10, 54, line, wcslen(line));
    swprintf(line, 300, L"入力した文字: %ls", text); TextOutW(mem, 10, 76, line, wcslen(line));
    HPEN pen = CreatePen(PS_SOLID, 4, RGB(11, 87, 208)); SelectObject(mem, pen);
    for (int i = 0; i < npts; i++) {
      if (pts[i].x < 0) continue;
      if (i == 0 || pts[i - 1].x < 0) MoveToEx(mem, pts[i].x, pts[i].y, NULL); else LineTo(mem, pts[i].x, pts[i].y);
    }
    BitBlt(dc, 0, 0, r.right, r.bottom, mem, 0, 0, SRCCOPY);
    DeleteObject(pen); DeleteObject(f); DeleteObject(bmp); DeleteDC(mem);
    EndPaint(hw, &ps); return 0;
  }
  case WM_ERASEBKGND: return 1;
  case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hw, m, w, l);
}

int WINAPI WinMain(HINSTANCE hi, HINSTANCE p, LPSTR c, int s) {
  WNDCLASSW wc = {0}; wc.lpfnWndProc = wp; wc.hInstance = hi; wc.lpszClassName = L"input"; wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  RegisterClassW(&wc);
  CreateWindowW(L"input", L"入力テスト", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL, hi, NULL);
  MSG msg; while (GetMessageW(&msg, NULL, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}

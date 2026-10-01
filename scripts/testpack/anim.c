// 動き・音テスト：ボールが跳ね回り、1 秒あたりの描画回数（FPS）を表示。壁に当たると音が鳴る
#include <windows.h>
#include <mmsystem.h>
#include <math.h>
#include <wchar.h>

#define RATE 22050
static HWAVEOUT wo;
static WAVEHDR hdr[4];
static short buf[4][RATE / 5];
static int nextBuf = 0, sound = 1;

static void beep(double freq) {
  if (!wo || !sound) return;
  WAVEHDR *h = &hdr[nextBuf];
  if (h->dwFlags & WHDR_PREPARED) { if (!(h->dwFlags & WHDR_DONE)) return; waveOutUnprepareHeader(wo, h, sizeof *h); }
  short *b = buf[nextBuf];
  int n = RATE / 5;
  for (int i = 0; i < n; i++) b[i] = (short)(9000 * sin(2 * 3.14159265 * freq * i / RATE) * (1.0 - (double)i / n));
  memset(h, 0, sizeof *h); h->lpData = (LPSTR)b; h->dwBufferLength = n * 2;
  waveOutPrepareHeader(wo, h, sizeof *h); waveOutWrite(wo, h, sizeof *h);
  nextBuf = (nextBuf + 1) % 4;
}

int WINAPI WinMain(HINSTANCE hi, HINSTANCE p, LPSTR c, int s) {
  WAVEFORMATEX fmt = { WAVE_FORMAT_PCM, 1, RATE, RATE * 2, 2, 16, 0 };
  if (waveOutOpen(&wo, WAVE_MAPPER, &fmt, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) wo = NULL;
  WNDCLASSW wc = {0}; wc.lpfnWndProc = DefWindowProcW; wc.hInstance = hi; wc.lpszClassName = L"anim"; wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  RegisterClassW(&wc);
  HWND hw = CreateWindowW(L"anim", L"動き・音テスト", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL, hi, NULL);
  double x = 100, y = 120, vx = 4.2, vy = 3.1;
  DWORD last = GetTickCount(), frames = 0, fps = 0;
  HFONT f = CreateFontW(17, 0, 0, 0, 400, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, L"MS UI Gothic");
  for (;;) {
    MSG msg;
    while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
      if (msg.message == WM_QUIT) return 0;
      if (msg.message == WM_KEYDOWN && msg.wParam == VK_SPACE) sound = !sound;
      if (msg.message == WM_LBUTTONDOWN) { vx = -vx; beep(660); }
      if (msg.message == WM_CLOSE || (msg.message == WM_SYSCOMMAND && msg.wParam == SC_CLOSE)) return 0;
      TranslateMessage(&msg); DispatchMessageW(&msg);
    }
    if (!IsWindow(hw)) return 0;
    RECT r; GetClientRect(hw, &r);
    x += vx; y += vy;
    if (x < 20 || x > r.right - 20) { vx = -vx; x += vx; beep(440); }
    if (y < 60 || y > r.bottom - 20) { vy = -vy; y += vy; beep(550); }
    HDC dc = GetDC(hw);
    HDC mem = CreateCompatibleDC(dc);
    HBITMAP bmp = CreateCompatibleBitmap(dc, r.right, r.bottom);
    SelectObject(mem, bmp);
    HBRUSH bg = CreateSolidBrush(RGB(20, 24, 32)); FillRect(mem, &r, bg); DeleteObject(bg);
    HBRUSH ball = CreateSolidBrush(RGB(255, 190, 40)); SelectObject(mem, ball);
    Ellipse(mem, (int)x - 18, (int)y - 18, (int)x + 18, (int)y + 18);
    SelectObject(mem, f); SetBkMode(mem, TRANSPARENT); SetTextColor(mem, RGB(240, 240, 240));
    wchar_t line[200];
    swprintf(line, 200, L"FPS: %lu   音: %ls（Space で切替・クリックで反転）", fps, !wo ? L"出力なし" : sound ? L"オン" : L"オフ");
    TextOutW(mem, 10, 10, line, wcslen(line));
    BitBlt(dc, 0, 0, r.right, r.bottom, mem, 0, 0, SRCCOPY);
    DeleteObject(ball); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(hw, dc);
    frames++;
    DWORD now = GetTickCount();
    if (now - last >= 1000) { fps = frames * 1000 / (now - last); frames = 0; last = now; }
    Sleep(15);
  }
}

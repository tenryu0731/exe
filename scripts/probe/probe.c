// E2E 用の確認アプリ（i686-w64-mingw32-gcc -O1 -o probe.exe probe.c -mwindows -lgdi32）。
// ゲームがよく行う操作（相対パス・日本語パス・自分のフォルダへの保存・DirectX・日本語フォント）を試し、
// 結果を画面に描き、標準出力にも「PROBE OK/NG …」として出す
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

static wchar_t lines[40][200];
static int ok[40];
static int n = 0;
static void rep(int good, const wchar_t *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  _vsnwprintf(lines[n], 199, fmt, ap); va_end(ap);
  ok[n++] = good;
}

static void run_checks(void) {
  wchar_t mod[MAX_PATH], cwd[MAX_PATH];
  GetModuleFileNameW(NULL, mod, MAX_PATH);
  GetCurrentDirectoryW(MAX_PATH, cwd);
  wchar_t dir[MAX_PATH]; wcscpy(dir, mod); *wcsrchr(dir, L'\\') = 0;
  rep(_wcsicmp(dir, cwd) == 0, L"cwd = exe folder: %ls", cwd);
  rep(1, L"exe: %ls", mod);
  rep(1, L"ACP=%u OEMCP=%u", GetACP(), GetOEMCP());

  char buf[64] = {0}; DWORD rd = 0;
  HANDLE h = CreateFileA("data\\test.txt", GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  if (h != INVALID_HANDLE_VALUE) { ReadFile(h, buf, 60, &rd, NULL); CloseHandle(h); }
  rep(h != INVALID_HANDLE_VALUE && strncmp(buf, "hello", 5) == 0, L"relative read data\\test.txt: %hs", buf);

  h = CreateFileA("DATA\\TEST.TXT", GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  rep(h != INVALID_HANDLE_VALUE, L"case-insensitive DATA\\TEST.TXT");
  if (h != INVALID_HANDLE_VALUE) CloseHandle(h);

  h = CreateFileW(L"データ\\日本語.txt", GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  memset(buf, 0, sizeof buf);
  if (h != INVALID_HANDLE_VALUE) { ReadFile(h, buf, 60, &rd, NULL); CloseHandle(h); }
  rep(h != INVALID_HANDLE_VALUE, L"Japanese path (W): %hs", buf);

  // CP932 の A 版 API（日本語ゲームの多くはこちら）
  const char sjisPath[] = "\x83\x66\x81\x5B\x83\x5E\\\x93\xFA\x96\x7B\x8C\xEA.txt"; // データ\日本語.txt
  h = CreateFileA(sjisPath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  rep(h != INVALID_HANDLE_VALUE, L"Japanese path (A, CP932)");
  if (h != INVALID_HANDLE_VALUE) CloseHandle(h);

  // 自分のフォルダにセーブ
  CreateDirectoryA("save", NULL);
  int prev = 0;
  h = CreateFileA("save\\count.dat", GENERIC_READ, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (h != INVALID_HANDLE_VALUE) { ReadFile(h, &prev, 4, &rd, NULL); CloseHandle(h); }
  int next = prev + 1;
  h = CreateFileA("save\\count.dat", GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
  BOOL w = h != INVALID_HANDLE_VALUE && WriteFile(h, &next, 4, &rd, NULL);
  if (h != INVALID_HANDLE_VALUE) CloseHandle(h);
  rep(w, L"write save\\count.dat (run #%d)", next);

  HKEY k;
  rep(RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\ExeProbe", 0, NULL, 0, KEY_ALL_ACCESS, NULL, &k, NULL) == 0, L"registry write");

  HMODULE d3d9 = LoadLibraryA("d3d9.dll");
  void *(WINAPI *c9)(UINT) = d3d9 ? (void *)GetProcAddress(d3d9, "Direct3DCreate9") : NULL;
  void *dev = c9 ? c9(32) : NULL;
  rep(dev != NULL, L"Direct3DCreate9");
  HMODULE dd = LoadLibraryA("ddraw.dll");
  HRESULT (WINAPI *cdd)(GUID *, void **, void *) = dd ? (void *)GetProcAddress(dd, "DirectDrawCreate") : NULL;
  void *ddo = NULL;
  rep(cdd && cdd(NULL, &ddo, NULL) == 0, L"DirectDrawCreate");
  HMODULE ds = LoadLibraryA("dsound.dll");
  HRESULT (WINAPI *cds)(void *, void **, void *) = ds ? (void *)GetProcAddress(ds, "DirectSoundCreate") : NULL;
  void *dso = NULL;
  rep(cds && cds(NULL, &dso, NULL) == 0, L"DirectSoundCreate");
  rep(LoadLibraryA("d3dx9_43.dll") != NULL, L"d3dx9_43.dll");
  rep(LoadLibraryA("msvcp140.dll") != NULL, L"msvcp140.dll");
  rep(LoadLibraryA("dinput8.dll") != NULL, L"dinput8.dll");
  rep(LoadLibraryA("winmm.dll") != NULL && LoadLibraryA("quartz.dll") != NULL, L"winmm / quartz (DirectShow)");
  rep(LoadLibraryA("mscoree.dll") != NULL, L"mscoree.dll (.NET loader)");
  wchar_t sys[MAX_PATH]; GetSystemDirectoryW(sys, MAX_PATH);
  wchar_t mono[MAX_PATH]; GetWindowsDirectoryW(mono, MAX_PATH); wcscat(mono, L"\\mono");
  rep(GetFileAttributesW(mono) != INVALID_FILE_ATTRIBUTES, L"Wine Mono (%ls)", mono);
  wchar_t gecko[MAX_PATH]; GetSystemDirectoryW(gecko, MAX_PATH); wcscat(gecko, L"\\gecko");
  rep(GetFileAttributesW(gecko) != INVALID_FILE_ATTRIBUTES, L"Wine Gecko");
}

static void font_check(HDC dc) {
  const wchar_t *faces[] = { L"ＭＳ ゴシック", L"MS Gothic", L"MS UI Gothic", L"ＭＳ Ｐゴシック", L"ＭＳ 明朝", L"Meiryo" };
  for (int i = 0; i < 6; i++) {
    HFONT f = CreateFontW(16, 0, 0, 0, 400, 0, 0, 0, SHIFTJIS_CHARSET, 0, 0, 0, 0, faces[i]);
    HGDIOBJ o = SelectObject(dc, f);
    WORD gi[2] = {0};
    GetGlyphIndicesW(dc, L"あ漢", 2, gi, GGI_MARK_NONEXISTING_GLYPHS);
    wchar_t got[64] = {0}; GetTextFaceW(dc, 63, got);
    rep(gi[0] != 0xffff && gi[1] != 0xffff, L"font %ls -> %ls glyph=%u,%u", faces[i], got, gi[0], gi[1]);
    SelectObject(dc, o); DeleteObject(f);
  }
}

static LRESULT CALLBACK wp(HWND hw, UINT m, WPARAM wpar, LPARAM lp) {
  if (m == WM_PAINT) {
    PAINTSTRUCT ps; HDC dc = BeginPaint(hw, &ps);
    RECT r; GetClientRect(hw, &r);
    HBRUSH bg = CreateSolidBrush(RGB(250, 250, 245)); FillRect(dc, &r, bg); DeleteObject(bg);
    HFONT f = CreateFontW(15, 0, 0, 0, 400, 0, 0, 0, SHIFTJIS_CHARSET, 0, 0, 0, 0, L"MS UI Gothic");
    SelectObject(dc, f); SetBkMode(dc, TRANSPARENT);
    for (int i = 0; i < n; i++) {
      SetTextColor(dc, ok[i] ? RGB(0, 110, 40) : RGB(200, 0, 0));
      wchar_t t[220]; swprintf(t, 220, L"%ls %ls", ok[i] ? L"OK  " : L"NG  ", lines[i]);
      TextOutW(dc, 8, 6 + i * 17, t, wcslen(t));
    }
    SetTextColor(dc, RGB(0, 0, 0));
    TextOutW(dc, 8, 6 + n * 17 + 4, L"日本語表示テスト：あいうえお 漢字 カタカナ", (int)wcslen(L"日本語表示テスト：あいうえお 漢字 カタカナ"));
    EndPaint(hw, &ps); return 0;
  }
  if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(hw, m, wpar, lp);
}

int WINAPI WinMain(HINSTANCE hi, HINSTANCE p, LPSTR c, int s) {
  run_checks();
  HDC sdc = GetDC(NULL); font_check(sdc); ReleaseDC(NULL, sdc);
  FILE *lf = _wfopen(L"probe-result.txt", L"w, ccs=UTF-8");
  for (int i = 0; i < n; i++) fwprintf(lf, L"%ls %ls\n", ok[i] ? L"OK" : L"NG", lines[i]);
  fclose(lf);
  for (int i = 0; i < n; i++) { char a[400]; WideCharToMultiByte(CP_UTF8, 0, lines[i], -1, a, 400, 0, 0); printf("PROBE %s %s\n", ok[i] ? "OK" : "NG", a); }
  fflush(stdout);
  WNDCLASSW wc = {0}; wc.lpfnWndProc = wp; wc.hInstance = hi; wc.lpszClassName = L"probe"; wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  RegisterClassW(&wc);
  HWND hw = CreateWindowW(L"probe", L"Probe テスト", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 640, 600, NULL, NULL, hi, NULL);
  MSG msg; while (GetMessageW(&msg, NULL, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}

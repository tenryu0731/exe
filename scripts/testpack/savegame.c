// セーブのテスト用ゲーム：画面を押すと数が増え、3 つのスロットにセーブ・ロードできる。
// セーブは exe と同じ場所の Save\slot1.txt 〜 slot3.txt（中身は読める文字）、
// 起動回数などの設定は %APPDATA%\ExeLauncherTest\config.ini に書く（ユーザーのデータ側のテスト用）。
// すべて画面のボタンで操作でき、キーボードでも Space=+1・1〜3=スロット・S=セーブ・L=ロード・R=リセット。
#include <windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <wchar.h>

static int count = 0, slot = 1, launches = 0;
static wchar_t message[200] = L"";
static wchar_t slotInfo[3][120];
static wchar_t configPath[MAX_PATH];

typedef struct { RECT r; const wchar_t *label; int id; } Btn;
static Btn btns[8];
static int nbtn = 0;
enum { B_PLUS = 1, B_S1, B_S2, B_S3, B_SAVE, B_LOAD, B_RESET };

static void slotPath(int s, wchar_t *out) { swprintf(out, MAX_PATH, L"Save\\slot%d.txt", s); }

static void refreshSlots(void) {
  for (int s = 1; s <= 3; s++) {
    wchar_t p[MAX_PATH]; slotPath(s, p);
    FILE *f = _wfopen(p, L"r");
    if (!f) { swprintf(slotInfo[s - 1], 120, L"スロット%d: （空き）", s); continue; }
    int c = 0; char when[64] = "";
    char line[128];
    while (fgets(line, sizeof line, f)) {
      if (!strncmp(line, "count=", 6)) c = atoi(line + 6);
      if (!strncmp(line, "saved=", 6)) { strncpy(when, line + 6, 63); when[strcspn(when, "\r\n")] = 0; }
    }
    fclose(f);
    swprintf(slotInfo[s - 1], 120, L"スロット%d: 数 %d（%hs）", s, c, when);
  }
}

static void saveSlot(void) {
  CreateDirectoryW(L"Save", NULL);
  wchar_t p[MAX_PATH]; slotPath(slot, p);
  FILE *f = _wfopen(p, L"w");
  if (!f) { wcscpy(message, L"セーブできませんでした"); return; }
  SYSTEMTIME t; GetLocalTime(&t);
  fprintf(f, "count=%d\nsaved=%04d-%02d-%02d %02d:%02d:%02d\n", count, t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
  fclose(f);
  swprintf(message, 200, L"スロット%d にセーブしました（Save\\slot%d.txt）", slot, slot);
  refreshSlots();
}

static void loadSlot(void) {
  wchar_t p[MAX_PATH]; slotPath(slot, p);
  FILE *f = _wfopen(p, L"r");
  if (!f) { swprintf(message, 200, L"スロット%d は空です", slot); return; }
  char line[128];
  while (fgets(line, sizeof line, f)) if (!strncmp(line, "count=", 6)) count = atoi(line + 6);
  fclose(f);
  swprintf(message, 200, L"スロット%d をロードしました", slot);
}

static void loadConfig(void) {
  wchar_t dir[MAX_PATH];
  if (SHGetFolderPathW(NULL, CSIDL_APPDATA, NULL, 0, dir) != S_OK) return;
  wcscat(dir, L"\\ExeLauncherTest");
  CreateDirectoryW(dir, NULL);
  swprintf(configPath, MAX_PATH, L"%ls\\config.ini", dir);
  launches = GetPrivateProfileIntW(L"game", L"launches", 0, configPath) + 1;
  slot = GetPrivateProfileIntW(L"game", L"slot", 1, configPath);
  if (slot < 1 || slot > 3) slot = 1;
  wchar_t v[16]; swprintf(v, 16, L"%d", launches);
  WritePrivateProfileStringW(L"game", L"launches", v, configPath);
}

static void saveConfig(void) {
  if (!configPath[0]) return;
  wchar_t v[16]; swprintf(v, 16, L"%d", slot);
  WritePrivateProfileStringW(L"game", L"slot", v, configPath);
}

static void addBtn(int x, int y, int w, int h, const wchar_t *label, int id) {
  SetRect(&btns[nbtn].r, x, y, x + w, y + h); btns[nbtn].label = label; btns[nbtn].id = id; nbtn++;
}

static void act(int id, HWND hw) {
  if (id == B_PLUS) { count++; message[0] = 0; }
  else if (id >= B_S1 && id <= B_S3) { slot = id - B_S1 + 1; saveConfig(); swprintf(message, 200, L"スロット%d を選びました", slot); }
  else if (id == B_SAVE) saveSlot();
  else if (id == B_LOAD) loadSlot();
  else if (id == B_RESET) { count = 0; wcscpy(message, L"数を 0 に戻しました（セーブは消えません）"); }
  InvalidateRect(hw, NULL, FALSE);
}

static LRESULT CALLBACK wp(HWND hw, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
  case WM_LBUTTONDOWN: {
    POINT pt = { (short)LOWORD(l), (short)HIWORD(l) };
    for (int i = 0; i < nbtn; i++) if (PtInRect(&btns[i].r, pt)) { act(btns[i].id, hw); return 0; }
    act(B_PLUS, hw);
    return 0;
  }
  case WM_KEYDOWN:
    if (w == VK_SPACE) act(B_PLUS, hw);
    else if (w >= '1' && w <= '3') act(B_S1 + (int)(w - '1'), hw);
    else if (w == 'S') act(B_SAVE, hw);
    else if (w == 'L') act(B_LOAD, hw);
    else if (w == 'R') act(B_RESET, hw);
    return 0;
  case WM_PAINT: {
    PAINTSTRUCT ps; HDC dc = BeginPaint(hw, &ps);
    RECT r; GetClientRect(hw, &r);
    HDC mem = CreateCompatibleDC(dc);
    HBITMAP bmp = CreateCompatibleBitmap(dc, r.right, r.bottom);
    SelectObject(mem, bmp);
    HBRUSH bg = CreateSolidBrush(RGB(250, 250, 245)); FillRect(mem, &r, bg); DeleteObject(bg);
    SetBkMode(mem, TRANSPARENT);
    HFONT big = CreateFontW(64, 0, 0, 0, 700, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, L"MS UI Gothic");
    HFONT mid = CreateFontW(18, 0, 0, 0, 400, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, L"MS UI Gothic");
    HFONT bold = CreateFontW(18, 0, 0, 0, 700, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, L"MS UI Gothic");
    wchar_t t[200];
    SelectObject(mem, mid); SetTextColor(mem, RGB(60, 60, 60));
    swprintf(t, 200, L"セーブのテスト（%d 回目の起動）  画面を押すと数が増えます", launches);
    TextOutW(mem, 14, 10, t, wcslen(t));
    SelectObject(mem, big); SetTextColor(mem, RGB(11, 87, 208));
    swprintf(t, 200, L"%d", count);
    TextOutW(mem, 14, 34, t, wcslen(t));
    // ボタン
    SelectObject(mem, bold);
    for (int i = 0; i < nbtn; i++) {
      int on = btns[i].id >= B_S1 && btns[i].id <= B_S3 && btns[i].id - B_S1 + 1 == slot;
      HBRUSH b = CreateSolidBrush(on ? RGB(11, 87, 208) : btns[i].id == B_SAVE ? RGB(20, 120, 60) : RGB(230, 232, 236));
      FillRect(mem, &btns[i].r, b); DeleteObject(b);
      FrameRect(mem, &btns[i].r, (HBRUSH)GetStockObject(GRAY_BRUSH));
      SetTextColor(mem, on || btns[i].id == B_SAVE ? RGB(255, 255, 255) : RGB(20, 20, 20));
      DrawTextW(mem, btns[i].label, -1, &btns[i].r, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }
    SelectObject(mem, mid); SetTextColor(mem, RGB(30, 30, 30));
    for (int s = 0; s < 3; s++) TextOutW(mem, 14, 270 + s * 24, slotInfo[s], wcslen(slotInfo[s]));
    SetTextColor(mem, RGB(20, 120, 60));
    TextOutW(mem, 14, 350, message, wcslen(message));
    SetTextColor(mem, RGB(110, 110, 110));
    const wchar_t *h1 = L"セーブ: このゲームのフォルダの Save\\slot1〜3.txt";
    const wchar_t *h2 = L"設定: AppData\\ExeLauncherTest\\config.ini（起動回数・選んだスロット）";
    TextOutW(mem, 14, 384, h1, wcslen(h1));
    TextOutW(mem, 14, 406, h2, wcslen(h2));
    BitBlt(dc, 0, 0, r.right, r.bottom, mem, 0, 0, SRCCOPY);
    DeleteObject(big); DeleteObject(mid); DeleteObject(bold); DeleteObject(bmp); DeleteDC(mem);
    EndPaint(hw, &ps);
    return 0;
  }
  case WM_ERASEBKGND: return 1;
  case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hw, m, w, l);
}

int WINAPI WinMain(HINSTANCE hi, HINSTANCE p, LPSTR c, int s) {
  loadConfig();
  refreshSlots();
  addBtn(14, 112, 140, 44, L"＋1", B_PLUS);
  addBtn(14, 166, 110, 40, L"スロット1", B_S1);
  addBtn(132, 166, 110, 40, L"スロット2", B_S2);
  addBtn(250, 166, 110, 40, L"スロット3", B_S3);
  addBtn(14, 214, 110, 40, L"セーブ", B_SAVE);
  addBtn(132, 214, 110, 40, L"ロード", B_LOAD);
  addBtn(250, 214, 110, 40, L"リセット", B_RESET);
  WNDCLASSW wc = {0}; wc.lpfnWndProc = wp; wc.hInstance = hi; wc.lpszClassName = L"savegame"; wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  RegisterClassW(&wc);
  CreateWindowW(L"savegame", L"セーブのテスト", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL, hi, NULL);
  MSG msg; while (GetMessageW(&msg, NULL, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}

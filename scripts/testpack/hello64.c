// 64bit テスト：64bit の exe として起動したことをウインドウに表示する
#include <windows.h>
int WINAPI WinMain(HINSTANCE hi, HINSTANCE p, LPSTR c, int s) {
  MessageBoxW(NULL, sizeof(void *) == 8 ? L"64-bit OK: this is a 64-bit program." : L"Not 64-bit", L"64-bit test", MB_OK);
  return 0;
}

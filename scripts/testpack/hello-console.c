// コンソールテスト：名前を聞いて返事をする（キーボード入力の確認）
#include <stdio.h>
#include <string.h>
int main(void) {
  char name[100];
  printf("Console test\n");
  printf("Type your name and press Enter: ");
  fflush(stdout);
  if (!fgets(name, sizeof name, stdin)) return 0;
  name[strcspn(name, "\r\n")] = 0;
  printf("Hello, %s! It works.\n", name);
  printf("Press Enter to close.");
  fflush(stdout);
  getchar();
  return 0;
}

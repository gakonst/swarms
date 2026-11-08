#define MINIH264_IMPLEMENTATION
#define H264E_SVC_API 0
#define H264E_MAX_THREADS 0
#define H264E_ENABLE_DENOISE 0
#define __EMSCRIPTEN__ 1
#include "minih264e.h"

void *memcpy(void *to, const void *from, size_t size) {
  __builtin_memcpy(to, from, size);
  return to;
}

void *memmove(void *to, const void *from, size_t size) {
  __builtin_memmove(to, from, size);
  return to;
}

void *memset(void *to, int value, size_t size) {
  __builtin_memset(to, value, size);
  return to;
}

extern unsigned char __heap_base;

static unsigned char *top;
static H264E_persist_t *persist;
static H264E_scratch_t *scratch;
static unsigned char *rgba;
static unsigned char *planes;
static unsigned char *coded;
static int width;
static int height;

static void *take(size_t size) {
  size_t at = ((size_t)top + 63) & ~(size_t)63;
  size_t end = at + size;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) < 0) return 0;
  top = (unsigned char *)end;
  return (void *)at;
}

int start(int w, int h, int gop) {
  H264E_create_param_t create = {0};
  int persistSize = 0;
  int scratchSize = 0;
  top = &__heap_base;
  width = w;
  height = h;
  create.width = w;
  create.height = h;
  create.gop = gop;
  create.const_input_flag = 1;
  int failed = H264E_sizeof(&create, &persistSize, &scratchSize);
  if (failed) return -failed;
  persist = take(persistSize);
  scratch = take(scratchSize);
  rgba = take((size_t)w * h * 4);
  planes = take((size_t)w * h * 3 / 2);
  if (!persist || !scratch || !rgba || !planes) return -100;
  return -H264E_init(persist, &create);
}

unsigned char *pixels(void) {
  return rgba;
}

unsigned char *output(void) {
  return coded;
}

static void convert(void) {
  unsigned char *luma = planes;
  unsigned char *blue = planes + width * height;
  unsigned char *red = blue + (width / 2) * (height / 2);
  for (int y = 0; y < height; y++) {
    const unsigned char *row = rgba + (size_t)y * width * 4;
    unsigned char *out = luma + (size_t)y * width;
    for (int x = 0; x < width; x++) {
      int r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2];
      out[x] = (unsigned char)((47 * r + 157 * g + 16 * b + 4096 + 128) >> 8);
    }
  }
  for (int y = 0; y < height / 2; y++) {
    const unsigned char *one = rgba + (size_t)(y * 2) * width * 4;
    const unsigned char *two = one + width * 4;
    for (int x = 0; x < width / 2; x++) {
      int i = x * 8;
      int r = one[i] + one[i + 4] + two[i] + two[i + 4];
      int g = one[i + 1] + one[i + 5] + two[i + 1] + two[i + 5];
      int b = one[i + 2] + one[i + 6] + two[i + 2] + two[i + 6];
      blue[y * (width / 2) + x] = (unsigned char)((-26 * r - 86 * g + 112 * b + 131072 + 512) >> 10);
      red[y * (width / 2) + x] = (unsigned char)((112 * r - 102 * g - 10 * b + 131072 + 512) >> 10);
    }
  }
}

int encode(int qp, int key) {
  H264E_run_param_t run = {0};
  H264E_io_yuv_t frame;
  int size = 0;
  convert();
  frame.yuv[0] = planes;
  frame.yuv[1] = planes + width * height;
  frame.yuv[2] = frame.yuv[1] + (width / 2) * (height / 2);
  frame.stride[0] = width;
  frame.stride[1] = width / 2;
  frame.stride[2] = width / 2;
  run.frame_type = key ? H264E_FRAME_TYPE_KEY : 0;
  run.encode_speed = 4;
  run.qp_min = qp;
  run.qp_max = qp;
  int failed = H264E_encode(persist, scratch, &run, &frame, &coded, &size);
  return failed ? -failed : size;
}

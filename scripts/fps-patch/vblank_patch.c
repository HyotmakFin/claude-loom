/*
 * Loom FPS patch (Linux / WebKitGTK)
 *
 * WebKitGTK 在 Wayland 下拿不到 displayID 时会回退到 60Hz 的
 * DisplayVBlankMonitorTimer。该定时器的线程名为 "VBlankMonitor"，
 * 每帧 sleep 1000/60 ms。这里只拦截这个线程的 nanosleep，
 * 按 LOOM_VBLANK_HZ（默认 200）缩短休眠，从而把 rAF 上限提到显示器刷新率。
 *
 * 只影响名为 VBlankMonitor 的线程，其他线程的 sleep 原样透传。
 * 编译：cc -shared -fPIC -O2 -o libloom-vblank.so vblank_patch.c -ldl -lpthread
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static long target_ns(void) {
    static long ns = 0;
    if (!ns) {
        const char *v = getenv("LOOM_VBLANK_HZ");
        long hz = v ? atol(v) : 200;
        if (hz < 60) hz = 60;
        if (hz > 1000) hz = 1000;
        ns = 1000000000L / hz;
    }
    return ns;
}

static int is_vblank_thread(void) {
    static __thread int cached = 0;
    if (cached) return 1;
    char name[32] = {0};
    if (pthread_getname_np(pthread_self(), name, sizeof name) == 0 && strcmp(name, "VBlankMonitor") == 0) {
        cached = 1;
        return 1;
    }
    return 0;
}

static void shorten(struct timespec *req) {
    /* 只处理 60Hz 定时器那种 16.7ms 级别的相对 sleep */
    if (req->tv_sec == 0 && req->tv_nsec >= 1000000L && req->tv_nsec <= 20000000L) {
        req->tv_sec = 0;
        req->tv_nsec = target_ns();
    }
}

int nanosleep(const struct timespec *req, struct timespec *rem) {
    static int (*real)(const struct timespec *, struct timespec *) = 0;
    if (!real) real = dlsym(RTLD_NEXT, "nanosleep");
    if (is_vblank_thread() && req) {
        struct timespec r = *req;
        shorten(&r);
        return real(&r, rem);
    }
    return real(req, rem);
}

int clock_nanosleep(clockid_t clk, int flags, const struct timespec *req, struct timespec *rem) {
    static int (*real)(clockid_t, int, const struct timespec *, struct timespec *) = 0;
    if (!real) real = dlsym(RTLD_NEXT, "clock_nanosleep");
    if (!(flags & TIMER_ABSTIME) && is_vblank_thread() && req) {
        struct timespec r = *req;
        shorten(&r);
        return real(clk, flags, &r, rem);
    }
    return real(clk, flags, req, rem);
}

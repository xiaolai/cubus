"""Hold a CUDA context so the GPU never reaches deep idle.

trainer-a has seven resident CUDA tenants and has not hard-reset in 30 days; trainer-b has none,
drops to 208 MHz / 5 W between jobs, and reset four times on 2026-09-09. The documented cause of
the reset is power SPIKES, and the largest spike available on this box is deep-idle -> full load.
This removes that transition by keeping the floor occupied, which is what -lgc 300,2200 was
supposed to do and does only 70% of the time here.
"""
import time, torch
x = torch.zeros(64 * 1024 * 1024 // 4, device="cuda")   # 64 MiB, holds the context
while True:
    x.add_(1.0); torch.cuda.synchronize()               # a trivial touch, ~microseconds
    time.sleep(2.0)

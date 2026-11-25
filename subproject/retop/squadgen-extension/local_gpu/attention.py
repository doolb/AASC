"""推理专用的完整注意力查询分块，保留所有键值与原始缩放。"""
import types

import torch
from torch.nn import functional as F


def attend(q, k, v, scale, chunk):
    # 分块只沿 query 维度，softmax 始终覆盖全部 key，不近似或截断邻域。
    output = torch.empty_like(q)
    for start in range(0, q.shape[-2], chunk):
        output[..., start:start + chunk, :] = F.scaled_dot_product_attention(
            q[..., start:start + chunk, :], k, v, dropout_p=0.0, scale=scale)
    return output


def ae_forward(self, x, context=None, mask=None, **kwargs):
    if self.training or mask is not None or torch.is_grad_enabled():
        raise ValueError('分块 AE 注意力仅用于无 mask 的 no_grad/eval 推理')
    context = x if context is None else context
    batch, count, _ = x.shape
    heads = self.heads
    q = self.to_q(x).reshape(batch, count, heads, -1).transpose(1, 2)
    k, v = self.to_kv(context).chunk(2, dim=-1)
    k, v = [item.reshape(batch, context.shape[1], heads, -1).transpose(1, 2) for item in (k, v)]
    result = attend(self.q_norm(q), self.k_norm(k), v, self.scale, self._query_chunk)
    return self.drop_path(self.to_out(result.transpose(1, 2).reshape(batch, count, -1)))


def sit_forward(self, x):
    if self.training or torch.is_grad_enabled():
        raise ValueError('分块 SiT 注意力仅用于 no_grad/eval 推理')
    batch, count, channels = x.shape
    qkv = self.qkv(x).reshape(batch, count, 3, self.num_heads, self.head_dim).permute(2, 0, 3, 1, 4)
    q, k, v = qkv.unbind(0)
    result = attend(self.q_norm(q), self.k_norm(k), v, self.scale, self._query_chunk)
    return self.proj_drop(self.proj(result.transpose(1, 2).reshape(batch, count, channels)))


def install(model, chunk=512):
    from squadgen.network.models_ae import Attention as AEAttention
    from squadgen.network.models_sit import Attention as SiTAttention
    if chunk < 1:
        raise ValueError('attention chunk 必须为正数')
    matches = {AEAttention: ae_forward, SiTAttention: sit_forward}
    count = 0
    for module in model.modules():
        forward = matches.get(type(module))
        if forward is not None:
            module._query_chunk = chunk
            module.forward = types.MethodType(forward, module)
            count += 1
    if count == 0:
        raise ValueError('没有找到支持的注意力层')
    return count


def self_test(device='cpu'):
    from squadgen.network.models_ae import Attention as AEAttention
    from squadgen.network.models_sit import Attention as SiTAttention
    # 局部生成器避免验证改变正式采样 RNG。测试覆盖跨注意力和多 batch/head。
    with torch.random.fork_rng(devices=[torch.cuda.current_device()] if device == 'cuda' else []):
        torch.manual_seed(123)
        modules = [AEAttention(24, 32, heads=2, dim_head=8, qknorm=1),
                   SiTAttention(24, num_heads=3, qkv_bias=True, qk_norm=True)]
        report = {}
        for index, module in enumerate(modules):
            module = module.to(device).eval()
            x = torch.randn(2, 31, 24, device=device)
            kwargs = {'context': torch.randn(2, 47, 32, device=device)} if index == 0 else {}
            with torch.no_grad():
                reference = module(x, **kwargs)
                install(module, chunk=7)
                actual = module(x, **kwargs)
            torch.testing.assert_close(actual, reference, rtol=1e-5, atol=1e-6)
            report['ae_cross' if index == 0 else 'sit_self'] = float((actual - reference).abs().max())
        return report

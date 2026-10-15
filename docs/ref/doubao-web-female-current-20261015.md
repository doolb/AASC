# 豆包官网女声：当前界面实际列表

当前官网女声实际加载列表，保持网页顺序，27项，最后为桂乡甜妞；不含接口后续分页候选，未逐项验收合成。

日期：2026-10-15。首批30项过滤BV后27项；源码分页scroll监听绑定内部speaker-list，而该元素无滚动区；实际滚动在外层，当前DOM未加载第二页。

获取相同范围：女声分类只取第1页（page_size=30），排除style_id以BV开头的条目。本文件直接读取当前网页实际卡片，speaker使用style_id。

| 序号 | 名称 | id | style_id（speaker） | 标签 |
|---:|---|---|---|---|
| 1 | 温柔桃子（升级版） | 104 | zh_female_wenroutaozi_uranus_bigtts | 女、青年、温柔 |
| 2 | 阳光甜妹（升级版） | 5238154621186 | zh_female_yangguangtianmei_uranus_bigtts | 女、青年、台湾口音、温柔 |
| 3 | 温柔桃子（经典版） | 29798555618523394 | zh_female_wenroutaozi_v2_mars_bigtts | 女、青年、温柔 |
| 4 | 邻家女孩 | 2 | zh_female_f261_conversation_wvae_bigtts | 女、青年、耐心 |
| 5 | 魅力苏菲 | 28 | zh_female_sophie_conversation_wvae_bigtts | 女、青年、温柔 |
| 6 | 撒娇学妹 | 18770280826114 | zh_female_yuanqinvyou_wvae_bigtts | 女、少年、娇气 |
| 7 | 甜美小雪 | 3092232558775554 | ICL_6acf86286e24 | 女、青年、可爱 |
| 8 | 清冷阿梦 | 3092321416028418 | ICL_16cd9a58768e | 女、青年、成熟 |
| 9 | 文静毛毛 | 117 | zh_female_maomao_conversation_wvae_bigtts | 女、青年、亲切 |
| 10 | 北京大妞 | 20556312119633410 | zh_female_beijingdaniu_mars_bigtts | 女、青年、北京口音、开朗 |
| 11 | 清甜瑶瑶 | 20557006477633026 | zh_female_F466_mars_bigtts | 女、青年、甜美 |
| 12 | 活泼可昕 | 20568646547030530 | zh_female_F765_mars_bigtts | 女、青年、活泼 |
| 13 | 灵兔少女 | 2214023244143618 | ICL_eaf8dd4a3a0d | 女、少年、可爱 |
| 14 | 顾姐 | 2449989985516290 | zh_female_guli_stream_gpu | 女、青年、倔强 |
| 15 | 雷霆女神 | 2449901835794690 | zh_female_leidian | 女、青年、成熟 |
| 16 | 绯樱神巫 | 2516455981560834 | ICL_19abc3128fbb | 女、青年、优雅 |
| 17 | 火舞魅娘 | 3091664424064770 | ICL_be2856499af4 | 女、青年、妩媚 |
| 18 | 沪上傲女 | 822277203826690 | ICL_7b76e4aafb6c | 女、青年、倔强 |
| 19 | 高冷御姐 | 34080658021028354 | zh_female_leidian_conversation_wvae_bigtts | 女、青年、傲娇 |
| 20 | 柔美女友 | 18592347738370 | zh_female_sajiaonvyou_wvae_bigtts | 女、青年、妩媚 |
| 21 | 爽快思思 | 118 | zh_female_sinong_conversation_wvae_bigtts | 女、青年、直率 |
| 22 | 妩媚御姐 | 18446559156482 | ICL_da05661f8c64 | 女、青年、妩媚 |
| 23 | 活泼女孩 | 18223469591298 | ICL_11c6b3f0bd6d | 女、少年、阳光 |
| 24 | 甜心小美 | 18776824088322 | ICL_bad46416a2b7 | 女、少年、温柔 |
| 25 | 魅力女友 | 15626754162946 | zh_female_meilinvyou_wvae_bigtts | 女、青年、妩媚 |
| 26 | 可爱女生 | 18592378481410 | ICL_49240bb7f5ac | 女、青年、天真 |
| 27 | 桂乡甜妞 | 903897616355586 | zh_female_guangxiwrn | 女、青年、广西口音、温柔 |

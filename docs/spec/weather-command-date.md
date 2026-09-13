# 天气识别日期实现伪代码

## 目标文件

- `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js` // 解析日期词、选择天气日和生成按日期输出
- `tests/weather-command.test.js` // 验证日期、城市和无数据场景

## 已有声明

- `sanitizeCityName()` 已负责从城市输入中移除“今天、明天、后天”等日期词。
- `resolveWeatherCity()` 已支持城市列表匹配和默认城市回退。
- `normalizeWeatherData()` 已保留接口返回的逐日和逐时结构。
- `formatWeatherDetail()` 已只展开第一天逐时内容。

## 新增定义

```text
WEATHER_DATE_OFFSETS = {
    今天: 0,
    今日: 0,
    明天: 1,
    明日: 1,
    后天: 2,
    后日: 2
}

parseWeatherDateRequest(text, now = new Date()):
    按“后天、后日、明天、明日、今天、今日”顺序查找日期词
    如果没有日期词:
        返回 { offset: null, date: null, label: '' }
    offset = WEATHER_DATE_OFFSETS[匹配词]
    targetDate = 使用 now 的本地年月日 + offset 计算
    返回 { offset, date: YYYY-MM-DD, label: 匹配词 }

selectWeatherForecastDay(weather, dateRequest):
    如果 dateRequest.offset == null:
        返回 null
    如果 dateRequest.offset == 0:
        返回 weather.forecast[0]
    返回 weather.forecast 中 date == dateRequest.date 的日期
```

## 操作流程

```text
handleWeatherCommand(text):
    dateRequest = parseWeatherDateRequest(text)
    weatherRequest = resolveWeatherCity(text)
    请求城市天气接口
    normalizedWeather = normalizeWeatherData(data, cityName)

    如果 dateRequest.offset == null:
        使用现有完整详情和语音摘要
    否则:
        day = selectWeatherForecastDay(normalizedWeather, dateRequest)
        如果 day 不存在:
            detailText = '暂无该日期天气预报'
            speechText = '暂无该日期天气预报'
        否则如果 offset == 0:
            detailText = 当前天气 + day 的逐日/天文/逐时详情
            speechText = 当前天气 + day 的简短摘要
        否则:
            detailText = day 的逐日/天文详情
            speechText = day 的逐日简短摘要

    按原有 callbacks 返回 detailText、speechText 和结构化 weather
```

## 验证

```text
今天 -> forecast[0] 且详情包含逐时
明天 -> 匹配本地日期 + 1 且只返回逐日
后天 -> 匹配本地日期 + 2 且只返回逐日
成都明天天气 -> 城市为成都、日期为明天
后天成都天气 -> 城市为成都、日期为后天
无对应日期 -> '暂无该日期天气预报'
无日期 -> 保持原有完整天气行为
```

'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    normalizeWeatherData,
    formatWeatherDetail,
    formatWeatherSpeech,
    parseWeatherDateRequest,
    selectWeatherForecastDay,
    formatWeatherDateDetail,
    formatWeatherDateSpeech,
    resolveWeatherCity
} = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

const formatTestDate = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
].join('-');

const createWeatherPayload = (baseDate = new Date(2026, 7, 29)) => ({
    nearest_area: [{
        areaName: [{ value: 'Chengdu' }],
        country: [{ value: 'China' }],
        region: [{ value: 'Sichuan' }],
        latitude: '30.667',
        longitude: '104.067'
    }],
    current_condition: [{
        observation_time: '02:24 PM',
        temp_C: '22',
        FeelsLikeC: '24',
        humidity: '84',
        pressure: '1012',
        visibility: '5',
        winddir16Point: 'SW',
        winddirDegree: '224',
        windspeedKmph: '10',
        weatherCode: '143',
        weatherDesc: [{ value: 'Mist' }],
        lang_zh: [{ value: 'Mist' }],
        cloudcover: '98',
        precipMM: '0.0',
        uvIndex: '0'
    }],
    weather: [0, 1, 2, 3].map((dayIndex) => {
        const forecastDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
        return {
        date: formatTestDate(forecastDate),
        maxtempC: String(25 + dayIndex),
        mintempC: String(20 + dayIndex),
        avgtempC: String(22 + dayIndex),
        sunHour: '4.2',
        totalSnow_cm: '0.0',
        uvIndex: String(dayIndex + 1),
        astronomy: [{
            sunrise: '06:25 AM',
            sunset: '07:30 PM',
            moonrise: '04:15 AM',
            moonset: '06:20 PM',
            moon_phase: 'Waning Crescent',
            moon_illumination: '12'
        }],
        hourly: [{
            time: dayIndex === 0 ? '0' : '300',
            tempC: '20',
            FeelsLikeC: '20',
            humidity: '90',
            weatherCode: '143',
            weatherDesc: [{ value: 'Mist' }],
            lang_zh: [{ value: 'Mist' }],
            chanceofrain: '20',
            chanceoffog: '80',
            chanceofsnow: '0',
            chanceofsunshine: '10',
            precipMM: '0.1',
            uvIndex: '1',
            visibility: '5',
            winddir16Point: 'SW',
            windspeedKmph: '8',
            WindGustKmph: '15',
            cloudcover: '95'
        }]
        };
    })
});

test('normalizeWeatherData 将完整 j1 数据归一化并把 Mist 转为中文', () => {
    const weather = normalizeWeatherData(createWeatherPayload());

    assert.equal(weather.location.name, 'Chengdu');
    assert.equal(weather.location.latitude, 30.667);
    assert.equal(weather.current.temperatureC, 22);
    assert.equal(weather.current.feelsLikeC, 24);
    assert.equal(weather.current.humidityPercent, 84);
    assert.equal(weather.current.pressureHpa, 1012);
    assert.equal(weather.current.visibilityKm, 5);
    assert.equal(weather.current.wind.direction, 'SW');
    assert.equal(weather.current.wind.speedKmph, 10);
    assert.equal(weather.current.weatherCode, 143);
    assert.equal(weather.current.condition, '雾');
    assert.equal(weather.forecast.length, 3);
    assert.equal(weather.forecast[0].astronomy.moonPhase, 'Waning Crescent');
    assert.equal(weather.forecast[0].hourly[0].chanceOfRainPercent, 20);
    assert.equal(weather.forecast[0].hourly[0].precipitationMm, 0.1);
    assert.equal(weather.forecast[0].hourly[0].wind.gustKmph, 15);
});

test('天气完整文本包含当前、逐日、逐时、天文和指标信息', () => {
    const weather = normalizeWeatherData(createWeatherPayload());
    const detail = formatWeatherDetail(weather);

    assert.match(detail, /Chengdu当前天气：雾/u);
    assert.match(detail, /体感24℃/u);
    assert.match(detail, /湿度84%/u);
    assert.match(detail, /气压1012百帕/u);
    assert.match(detail, /能见度5公里/u);
    assert.match(detail, /风向SW，风速10公里每小时/u);
    assert.match(detail, /天气编码143/u);
    assert.match(detail, /未来3天预报/u);
    assert.match(detail, /2026-08-29/u);
    assert.match(detail, /逐时预报/u);
    assert.match(detail, /00:00时雾/u);
    assert.match(detail, /降雨概率20%/u);
    assert.match(detail, /日出06:25 AM/u);
    assert.match(detail, /月相Waning Crescent/u);
});

test('天气详情只展示今日逐时数据，未来日期不展开逐时明细', () => {
    const weather = normalizeWeatherData(createWeatherPayload());
    const detail = formatWeatherDetail(weather);

    assert.match(detail, /2026-08-29：雾/u);
    assert.match(detail, /00:00时雾/u);
    assert.match(detail, /2026-08-30：雾/u);
    assert.doesNotMatch(detail, /03:00时雾/u);
    assert.equal(weather.forecast[1].hourly[0].time, '300');
});

test('天气语音摘要保留当前天气和逐日概览但不播报逐时明细', () => {
    const weather = normalizeWeatherData(createWeatherPayload());
    const speech = formatWeatherSpeech(weather);

    assert.match(speech, /Chengdu当前天气：雾/u);
    assert.match(speech, /未来3天/u);
    assert.doesNotMatch(speech, /逐时预报/u);
    assert.doesNotMatch(speech, /天气编码143/u);
});

test('天气编码 149 将 Smoky haze 转为霾', () => {
    const payload = createWeatherPayload();
    payload.current_condition[0].weatherCode = '149';
    payload.current_condition[0].lang_zh = [{ value: 'Smoky haze' }];
    payload.current_condition[0].weatherDesc = [{ value: 'Smoky haze' }];

    const weather = normalizeWeatherData(payload);

    assert.equal(weather.current.condition, '霾');
});

test('缺失天气字段使用 null，文案不出现 undefined', () => {
    const weather = normalizeWeatherData({
        nearest_area: [],
        current_condition: [{}],
        weather: []
    });
    const detail = formatWeatherDetail(weather);

    assert.equal(weather.current.temperatureC, null);
    assert.equal(weather.current.wind, null);
    assert.doesNotMatch(detail, /undefined/u);
});

test('天气日期解析使用服务端本地日期并支持三种相对日期', () => {
    const now = new Date(2026, 8, 12, 10, 30, 0);

    assert.deepEqual(parseWeatherDateRequest('今天的天气', now), {
        offset: 0,
        date: '2026-09-12',
        label: '今天'
    });
    assert.deepEqual(parseWeatherDateRequest('成都明天天气', now), {
        offset: 1,
        date: '2026-09-13',
        label: '明天'
    });
    assert.deepEqual(parseWeatherDateRequest('后天成都天气', now), {
        offset: 2,
        date: '2026-09-14',
        label: '后天'
    });
    assert.deepEqual(parseWeatherDateRequest('成都天气', now), {
        offset: null,
        date: null,
        label: ''
    });
});

test('天气城市解析会剔除日期词并支持日期在城市前后', () => {
    assert.equal(resolveWeatherCity('成都明天天气').city, '成都');
    assert.equal(resolveWeatherCity('后天成都天气').city, '成都');
    assert.equal(resolveWeatherCity('今天的天气').requestedCity, '');
});

test('今天天气选择接口第一天并保留今日逐时预报', () => {
    const now = new Date(2026, 8, 12, 10, 30, 0);
    const weather = normalizeWeatherData(createWeatherPayload(now));
    const request = parseWeatherDateRequest('今天的天气', now);
    const day = selectWeatherForecastDay(weather, request);
    const detail = formatWeatherDateDetail(weather, request);

    assert.equal(day.date, '2026-09-12');
    assert.match(detail, /2026-09-12/u);
    assert.match(detail, /00:00时雾/u);
    assert.doesNotMatch(detail, /2026-09-13：/u);
});

test('明天和后天天气只返回对应逐日预报，不包含逐时和其他日期', () => {
    const now = new Date(2026, 8, 12, 10, 30, 0);
    const weather = normalizeWeatherData(createWeatherPayload(now));

    for (const text of ['明天天气', '后天天气']) {
        const request = parseWeatherDateRequest(text, now);
        const detail = formatWeatherDateDetail(weather, request);
        const speech = formatWeatherDateSpeech(weather, request);
        const expectedDate = request.date;

        assert.match(detail, new RegExp(expectedDate));
        assert.match(speech, new RegExp(expectedDate));
        assert.doesNotMatch(detail, /逐时预报/u);
        assert.doesNotMatch(detail, /当前天气/u);
        assert.doesNotMatch(detail, /00:00时/u);
        for (const date of ['2026-09-12', '2026-09-13', '2026-09-14']) {
            if (date !== expectedDate) {
                assert.doesNotMatch(detail, new RegExp(`${date}：`));
            }
        }
    }
});

test('目标日期没有对应预报时返回固定提示', () => {
    const now = new Date(2026, 8, 12, 10, 30, 0);
    const weather = normalizeWeatherData(createWeatherPayload(now));
    const request = parseWeatherDateRequest('后天天气', new Date(2027, 0, 1, 10, 30, 0));

    assert.equal(selectWeatherForecastDay(weather, request), null);
    assert.equal(formatWeatherDateDetail(weather, request), '暂无该日期天气预报');
    assert.equal(formatWeatherDateSpeech(weather, request), '暂无该日期天气预报');
});

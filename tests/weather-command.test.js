'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    normalizeWeatherData,
    formatWeatherDetail,
    formatWeatherSpeech
} = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

const createWeatherPayload = () => ({
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
    weather: [0, 1, 2, 3].map((dayIndex) => ({
        date: `2026-08-${String(29 + dayIndex).padStart(2, '0')}`,
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
            time: '0',
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
    }))
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

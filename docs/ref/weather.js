const axios = require('axios');

async function getWeather(city = 'Beijing') {
    try {
        // format=j1 表示返回 JSON 数据
        // lang=zh 表示语言（部分描述会中英混合）
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'curl' // wttr.in 要求模拟 curl 请求头
            }
        });

        const data = response.data;
        
        // 解析关键数据
        const current = data.current_condition[0];
        
        return {
            city: data.nearest_area[0].areaName[0].value,
            temp: current.temp_C, // 温度（摄氏度）
            weather: current.lang_zh ? current.lang_zh[0].value : current.weatherDesc[0].value, // 天气描述
            humidity: current.humidity, // 湿度
            windSpeed: current.windspeedKmph // 风速
        };

    } catch (error) {
        console.error('获取天气失败:', error.message);
        return null;
    }
}

// 测试
(async () => {
    const weather = await getWeather('Shanghai');
    console.log(weather);
})();

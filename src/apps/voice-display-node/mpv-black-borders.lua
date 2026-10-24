-- 只负责采集当前视频的小亮度图；检测、稳定确认和填充规则统一在JS中完成。
local token = nil
local timer = nil
local function stop()
    token = nil
    if timer then timer:kill(); timer = nil end
end

local function sample()
    if not token or mp.get_property_bool('pause', true) or mp.get_property_bool('idle-active', true) then return end
    local image = mp.command_native({'screenshot-raw', 'video', 'bgr0'})
    if not image or type(image.data) ~= 'string' or image.w < 1 or image.h < 1 then
        mp.commandv('script-message', 'aasc-black-borders-error', token or '')
        stop()
        return
    end
    local scale = math.min(1, 192 / math.max(image.w, image.h))
    local width = math.max(1, math.floor(image.w * scale + 0.5))
    local height = math.max(1, math.floor(image.h * scale + 0.5))
    local pixels = {}
    for y = 0, height - 1 do
        local sy = math.min(image.h - 1, math.floor((y + 0.5) * image.h / height))
        for x = 0, width - 1 do
            local sx = math.min(image.w - 1, math.floor((x + 0.5) * image.w / width))
            local pos = sy * image.stride + sx * 4 + 1
            local b, g, r = string.byte(image.data, pos, pos + 2)
            if not r then stop(); return end
            pixels[#pixels + 1] = string.format('%02x', math.max(r, g, b))
        end
    end
    mp.commandv('script-message', 'aasc-black-borders-frame', token,
        tostring(width), tostring(height), tostring(mp.get_property_number('time-pos', -1)),
        tostring(mp.get_property_number('video-rotate', 0)), table.concat(pixels))
end

mp.register_script_message('aasc-black-borders-start', function(value)
    stop()
    token = value
    timer = mp.add_periodic_timer(1, sample)
end)
mp.register_script_message('aasc-black-borders-stop', stop)
mp.register_event('start-file', stop)
mp.register_event('shutdown', stop)

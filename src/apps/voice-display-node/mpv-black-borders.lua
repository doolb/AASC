-- 优先传递原生逐帧候选，兼容回退为小亮度图；两帧确认和填充规则由JS完成。
local token = nil
local pending = false
local last_pts = nil
local native_filter = false
local missing_metadata = 0
local function remove_native_filter()
    for _, filter in ipairs(mp.get_property_native('vf', {})) do
        if filter.label == 'aasc-black-borders' then mp.commandv('vf', 'remove', '@aasc-black-borders'); break end
    end
    native_filter = false
end
-- 预生成字节查表，逐帧缩小时避免对每个像素调用string.format。
local hex = {}
for value = 0, 255 do hex[value] = string.format('%02x', value) end
local sample
local function stop()
    token = nil
    pending = false
    last_pts = nil
    missing_metadata = 0
    if sample then mp.unobserve_property(sample) end
    remove_native_filter()
end

sample = function(_, pts)
    if not token or pending or not pts or pts == last_pts or mp.get_property_bool('pause', true) or mp.get_property_bool('idle-active', true) then return end
    last_pts = pts
    if native_filter then
        local meta = mp.get_property_native('vf-metadata/aasc-black-borders') or {}
        if meta['lavfi.cropdetect.w'] and meta['lavfi.blackframe.pblack'] then
            missing_metadata = 0
            local rotation = (-mp.get_property_number('video-dec-params/rotate', 0)) % 360
            pending = true
            mp.commandv('script-message', 'aasc-black-borders-bounds', token,
                tostring(mp.get_property_number('video-out-params/w', 0)), tostring(mp.get_property_number('video-out-params/h', 0)),
                tostring(pts), tostring(rotation), meta['lavfi.cropdetect.x'], meta['lavfi.cropdetect.y'],
                meta['lavfi.cropdetect.w'], meta['lavfi.cropdetect.h'], meta['lavfi.blackframe.pblack'])
            return
        end
        missing_metadata = missing_metadata + 1
        if missing_metadata < 8 then return end
        remove_native_filter()
    end
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
            local row = image.stride < 0 and (image.h - 1 - sy) * -image.stride or sy * image.stride
            local pos = row + sx * 4 + 1
            local b, g, r = string.byte(image.data, pos, pos + 2)
            if not r then stop(); return end
            pixels[#pixels + 1] = hex[math.max(r, g, b)]
        end
    end
    pending = true
    mp.commandv('script-message', 'aasc-black-borders-frame', token,
        tostring(width), tostring(height), tostring(pts),
        tostring(mp.get_property_number('video-rotate', 0)), table.concat(pixels))
end

mp.register_script_message('aasc-black-borders-start', function(value)
    stop()
    token = value
    -- 只添加并移除本脚本的标签；元数据扫描不改变视频尺寸，不下载整帧RGB。
    local _, err = mp.command_native({'vf', 'add', '@aasc-black-borders:lavfi=[cropdetect=limit=24:round=2:reset=1,blackframe=amount=0:threshold=40]'})
    native_filter = err == nil
    if not native_filter then remove_native_filter() end
    mp.observe_property('time-pos', 'number', sample)
end)
mp.register_script_message('aasc-black-borders-ack', function(value)
    if token == value then pending = false end
end)
mp.register_script_message('aasc-black-borders-stop', stop)
mp.register_event('start-file', stop)
mp.register_event('shutdown', stop)

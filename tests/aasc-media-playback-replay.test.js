'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    buildNormalReplayMessages,
    isMediaFromNode,
    rewriteMediaForNode
} = require('../src/framework/aasc/media-replay');

const currentNode = {
    nodeId: 'APK-SM-N9500',
    url: 'https://192.168.1.7:8081'
};

test('单媒体重播沿用普通媒体消息并切换到节点新地址', () => {
    const messages = buildNormalReplayMessages({
        currentMedia: {
            type: 'url',
            url: 'https://192.168.1.6:8081/media/lib_1/movie.mp4',
            fallbackUrl: '/api/aasc/servers/APK-SM-N9500/media-libraries/lib-1/proxy/movie.mp4',
            mediaType: 'video',
            sourceNodeId: 'APK-SM-N9500'
        }
    }, currentNode, 'https://192.168.1.6:8081');

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'url');
    assert.equal(messages[0].url, 'https://192.168.1.7:8081/media/lib_1/movie.mp4');
    assert.equal(messages[0].fallbackUrl, '/api/aasc/servers/APK-SM-N9500/media-libraries/lib-1/proxy/movie.mp4');
    assert.equal(messages[0].mediaReplay, undefined);
});

test('只重播当前来自目标节点的媒体，其他节点媒体不受影响', () => {
    const media = {
        type: 'url',
        url: 'https://192.168.1.39:8081/uploads/main.mp4',
        mediaType: 'video',
        sourceNodeId: 'main-server'
    };

    assert.equal(isMediaFromNode(media, currentNode, 'https://192.168.1.6:8081'), false);
    assert.deepEqual(buildNormalReplayMessages({ currentMedia: media }, currentNode), []);
});

test('播放列表重播沿用 playlistStart 普通流程并保留当前列表断点', () => {
    const messages = buildNormalReplayMessages({
        currentPlaylist: {
            index: 1,
            state: 'playing',
            currentTime: 12.5,
            startData: {
                listId: 'list-1',
                loop: true,
                playlist: [
                    {
                        url: 'https://192.168.1.7:8081/media/lib_1/one.mp4',
                        mediaType: 'video',
                        sourceNodeId: 'APK-SM-N9500'
                    },
                    {
                        url: 'https://192.168.1.6:8081/media/lib_1/two.mp4',
                        mediaType: 'video',
                        sourceNodeId: 'APK-SM-N9500'
                    }
                ]
            }
        }
    }, currentNode, 'https://192.168.1.6:8081');

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'playlistStart');
    assert.equal(messages[0].resumeIndex, 1);
    assert.equal(messages[0].resumeTime, 12.5);
    assert.equal(messages[0].resumeState, 'playing');
    assert.equal(messages[0].playlist[1].url, 'https://192.168.1.7:8081/media/lib_1/two.mp4');
});

test('旧状态可用主服务代理路径识别来源节点', () => {
    const media = {
        type: 'url',
        url: '/api/aasc/servers/APK-SM-N9500/media-libraries/lib-1/proxy/movie.mp4',
        mediaType: 'video'
    };

    assert.equal(isMediaFromNode(media, currentNode), true);
    assert.equal(rewriteMediaForNode(media, currentNode).url, media.url);
});

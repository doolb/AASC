using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// 管理一组 UIViewBind 的列表绑定关系
/// 当列表引用变化或长度变化时调用 CallView()，当某个元素内容变化时调用 CallView(int)
/// 列表长度可能超过数据长度 (超出时数据可以为空)
/// 列表个数绑定委托给内部 UIViewBind&lt;int&gt; 实现
/// </summary>
/// <typeparam name="TData">绑定数据类型</typeparam>
public class UIViewBindList<TData> : IDisposable
{
    /// <summary>
    /// 内部绑定数据列表
    /// </summary>
    private List<UIViewBind<TData>> _list = new List<UIViewBind<TData>>();

    /// <summary>
    /// 数据到索引的映射
    /// </summary>
    public Dictionary<TData, int> indexMap = new Dictionary<TData, int>();

    /// <summary>
    /// 列表个数绑定（委托给 UIViewBind 管理绑定源和生命周期）
    /// </summary>
    public UIViewBind<int> CountBind = new UIViewBind<int>(0);

    /// <summary>
    /// 当前绑定的视图数量
    /// </summary>
    public int BindCount => CountBind.BindCount;

    /// <summary>
    /// 获取所有绑定源对象（仅用于编辑器调试）
    /// </summary>
    public IEnumerable<object> BindSources => CountBind.BindSources;

    /// <summary>
    /// 列表总长度（由外部传入维护）
    /// </summary>
    public int Count { get; private set; }

    /// <summary>
    /// 列表有效元素数量（由外部可单独维护）
    /// </summary>
    public int RealCount { get; private set; }

    /// <summary>
    /// 获取指定索引的绑定对象
    /// </summary>
    public UIViewBind<TData> this[int index] => _list[index];

    /// <summary>
    /// 获取内部列表
    /// </summary>
    public List<UIViewBind<TData>> DataList => _list;

    /// <summary>
    /// 设置整个列表数据，触发长度变化通知，触发每个子物体变化
    /// </summary>
    public void SetList(List<TData> dataList, int realCount = -1, int count = -1)
    {
        dataList ??= new List<TData>();
        if (count < 0)
            count = dataList.Count;
        Count = Math.Max(0, count);
        int dataCount = Math.Min(dataList.Count, Count);
        int validCount = realCount >= 0 ? Math.Min(realCount, dataCount) : dataCount;
        indexMap.Clear();
        for (int i = 0; i < Count; i++)
        {
            if (i >= _list.Count)
                CreateBind(i < dataCount ? dataList[i] : default);
            else
                _list[i].Data = i < dataCount ? dataList[i] : default;

            if (i < validCount && !EqualityComparer<TData>.Default.Equals(_list[i]._data, default))
                indexMap[_list[i]._data] = i;
        }
        RealCount = realCount >= 0 ? Math.Min(Math.Max(realCount, 0), Count) : indexMap.Count;
        // 触发长度变化通知
        CallView();
    }

    /// <summary>
    /// 单独设置有效元素数量（不影响列表总长度）
    /// </summary>
    public void SetRealCount(int realCount)
    {
        RealCount = Math.Min(Math.Max(realCount, 0), Count);
    }

    /// <summary>
    /// 添加元素，触发长度变化通知
    /// </summary>
    public void Add(TData data)
    {
        int addIndex = RealCount;
        if (addIndex < _list.Count)
            _list[addIndex].Data = data;
        else
            CreateBind(data);

        Count++;
        while (_list.Count < Count)
            CreateBind(default);

        if (!EqualityComparer<TData>.Default.Equals(data, default))
        {
            indexMap[data] = addIndex;
            RealCount = Math.Min(RealCount + 1, Count);
        }
        CallView();
    }

    /// <summary>
    /// 插入元素，触发长度变化通知
    /// </summary>
    public void Insert(int index, TData data)
    {
        if (index < 0)
            index = 0;
        if (index > Count)
            index = Count;

        var bind = new UIViewBind<TData>(data);
        _list.Insert(index, bind);
        Count++;

        if (!EqualityComparer<TData>.Default.Equals(data, default))
            RealCount = Math.Min(RealCount + 1, Count);

        RebuildIndexMap();
        CallView();
    }
    /// <summary>
    /// 按索引移除元素，触发长度变化通知
    /// </summary>
    public void RemoveAt(int index)
    {
        if (index < 0 || index >= Count || index >= _list.Count)
            return;

        _list[index]?.Dispose();
        _list.RemoveAt(index);
        Count = Math.Max(Count - 1, 0);
        if (index < RealCount)
            RealCount = Math.Max(RealCount - 1, 0);

        RebuildIndexMap();
        CallView();
    }

    /// <summary>
    /// 刷新索引
    /// </summary>
    public void RebuildIndexMap()
    {
        indexMap.Clear();
        int loopCount = Math.Min(Count, _list.Count);
        for (int i = 0; i < loopCount; i++)
        {
            var itemData = _list[i]._data;
            if (EqualityComparer<TData>.Default.Equals(itemData, default))
                continue;
            indexMap[itemData] = i;
        }
    }

    /// <summary>
    /// 清空列表，触发长度变化通知
    /// </summary>
    public void Clear()
    {
        foreach (var bind in _list)
            bind?.Dispose();
        _list.Clear();
        indexMap.Clear();
        Count = 0;
        RealCount = 0;
        CallView();
    }

    /// <summary>
    /// 创建绑定对象，并注册元素内容变化回调
    /// </summary>
    private UIViewBind<TData> CreateBind(TData data)
    {
        var bind = new UIViewBind<TData>(data);
        _list.Add(bind);
        
        return bind;
    }

    /// <summary>
    /// 通知列表引用变化或长度变化（通过 CountBind 通知所有订阅者）
    /// </summary>
    public void CallView()
    {
        int oldCount = CountBind._data;
        int newCount = Count;
        if (CountBind.BindCount > 0)
        {
            Log.Info($"{typeof(TData).Name} 列表引用变化或长度变化，旧长度：{oldCount}，新长度：{newCount}");
        }
        // 强制触发通知（即使长度未变，内容可能已变）
        CountBind._data = newCount;
        CountBind.CallView();
    }

    /// <summary>
    /// 通知列表中指定索引的内容变化
    /// </summary>
    /// <param name="index">变化的索引</param>
    public void CallView(int index)
    {
        _list[index].CallView();
    }

    /// <summary>
    /// 通知列表中内容变化
    /// </summary>
    /// <param name="data"></param>
    public void CallView(TData data)
    {
        if (indexMap.TryGetValue(data, out var index))
            CallView(index);
    }

    /// <summary>
    /// 获取下标
    /// </summary>
    public int GetIndex(TData data)
    {
        if (indexMap.TryGetValue(data, out var index))
            return index;
        return -1;
    }

    /// <summary>
    /// 绑定列表变化事件，委托给 CountBind
    /// 回调参数：newCount, oldCount
    /// </summary>
    public void Bind(object obj, Action<int, int> action)
    {
        CountBind.Bind(obj, (newCount) =>
        {
            action(newCount, CountBind.OldData);
        });
    }

    /// <summary>
    /// 解绑列表变化事件，委托给 CountBind
    /// </summary>
    public void UnBind(object obj)
    {
        CountBind.UnBind(obj);
    }

    /// <summary>
    /// 释放所有绑定
    /// </summary>
    public void Dispose()
    {
        foreach (var bind in _list)
            bind?.Dispose();
        _list.Clear();
        indexMap.Clear();
        Count = 0;
        RealCount = 0;
        CountBind.Dispose();
    }
}

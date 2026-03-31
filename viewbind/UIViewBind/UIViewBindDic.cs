using System;
using System.Collections.Generic;

/// <summary>
/// 管理一组以 TKey 为键、UIViewBind&lt;TData&gt; 为值的绑定关系
/// 提供 Bind/UnBind 以及统一释放的能力
/// </summary>
/// <typeparam name="TKey">键类型</typeparam>
/// <typeparam name="TData">绑定数据类型</typeparam>
public class UIViewBindDic<TKey, TData> : IDisposable
{
    /// <summary>
    /// 当字典中不存在指定键时，用于创建新 UIViewBind 实例的工厂方法
    /// </summary>
    private Func<TKey, UIViewBind<TData>> newBindCall;

    /// <summary>
    /// 构造函数
    /// </summary>
    /// <param name="newBind">创建 UIViewBind 实例的工厂方法</param>
    public UIViewBindDic(Func<TKey, UIViewBind<TData>> newBind)
    {
        newBindCall = newBind;
    }

    /// <summary>
    /// 存储键与 UIViewBind 实例的字典
    /// </summary>
    private Dictionary<TKey, UIViewBind<TData>> binds = new Dictionary<TKey, UIViewBind<TData>>();

    /// <summary>
    /// 将指定对象绑定到指定键的 UIViewBind 上
    /// 若键不存在，则先创建新的 UIViewBind 实例
    /// </summary>
    /// <param name="key">键</param>
    /// <param name="obj">要绑定的对象</param>
    /// <param name="handler">数据变更回调</param>
    public UIViewBind<TData> Get(TKey key)
    {
        if (!binds.TryGetValue(key, out var attr))
        {
            // 不存在，先创建再绑定
            attr = newBindCall(key);
            binds[key] = attr;
        }
        return attr;
    }

    /// <summary>
    /// 移除指定键的绑定关系
    /// </summary>
    /// <param name="key"></param>
    public void Remove(TKey key)
    {
        if (binds.ContainsKey(key))
            binds.Remove(key);
    }
    /// <summary>
    /// 刷新显示
    /// </summary>
    /// <param name="key"></param>
    public void CallView(TKey key)
    {
        if (binds.TryGetValue(key, out var attr))
            attr.CallView();
    }

    /// <summary>
    /// 释放所有 UIViewBind 实例并清空字典
    /// </summary>
    public void Dispose()
    {
        foreach (var item in binds.Values)
            item?.Dispose();
        binds.Clear();
    }
}
using System;
using System.Collections.Generic;

/// <summary>
/// UI视图绑定数据通知
/// </summary>
/// <typeparam name="T"></typeparam>
public class UIViewBind<T> : IDisposable
{
    /// <summary>
    /// 数据
    /// </summary>
    public T _data;
    /// <summary>
    /// 上一次数据
    /// </summary>
    public T OldData { get; private set; }
    
    /// <summary>
    /// 设置数据,并刷新显示
    /// </summary>
    public T Data
    {
        get => _data;
        set
        {
            // 避免新旧数据都为空时触发不必要的数据变化事件
            if (_data == null && value == null)
            {
                _data = value;
                return;
            }
            if ((_data == null && value != null) || 
                (_data != null && value == null) ||
                !_data.Equals(value))
            {
                _data = value;
                CallView();
            }
            else
            {
                _data = value;
            }
        }
    }
    /// <summary>
    /// 数据改变时调用视图
    /// </summary>
    public void Get(Func<T, bool> func)
    {
        if (func(_data))
            CallView();
    }

    /// <summary>
    /// 消息处理函数
    /// </summary>
    private GetDataFromMsg onMsg;
    public delegate T GetDataFromMsg(T old);
    /// <summary>
    /// 消息代码
    /// </summary>
    private string msgCode;

    /// <summary>
    /// 默认构造：仅初始化数据
    /// </summary>
    public UIViewBind(T _data = default(T))
    {
        this._data = _data;
    }

    /// <summary>
    /// 带消息监听的构造：自动注册事件
    /// </summary>
    /// <param name="msg">消息代码</param>
    /// <param name="onmsg">消息处理函数</param>
    /// <param name="initData">初始数据</param>
    public UIViewBind(string msg, GetDataFromMsg onmsg, T initData = default(T))
    {
        onMsg = onmsg;
        msgCode = msg;
        _data = onMsg(initData);
        Events.AddListener(msgCode, OnMsg, this);
    }

    /// <summary>
    /// 收到消息时更新数据并刷新视图
    /// </summary>
    /// <param name="args">消息参数</param>
    private void OnMsg(object[] args)
    {
        if (onMsg != null)
        {
            _data = onMsg(_data);
            CallView();
        }
    }

    /// <summary>
    /// 视图事件集合：key为订阅者对象，value为回调
    /// </summary>
    Dictionary<object, Action<T>> viewEvent = new Dictionary<object, Action<T>>();

    /// <summary>
    /// 当前绑定的视图数量
    /// </summary>
    public int BindCount => viewEvent.Count;

    /// <summary>
    /// 获取所有绑定源对象（仅用于编辑器调试）
    /// </summary>
    public IEnumerable<object> BindSources => viewEvent.Keys;

    /// <summary>
    /// 是否正在触发视图回调
    /// </summary>
    private bool _isCallingView;

    /// <summary>
    /// 延迟解绑队列（仅在CallView遍历期间使用）
    /// </summary>
    private List<object> _pendingUnbinds;
    /// <summary>
    /// 延迟绑定队列（仅在CallView遍历期间使用）
    /// </summary>
    private Dictionary<object, Action<T>> _pendingBinds;

    /// <summary>
    /// 触发所有已绑定的视图回调
    /// </summary>
    public void CallView()
    {
        if (_isCallingView)
            return;
        _isCallingView = true;
        foreach (var view in viewEvent)
        {
            // 跳过已销毁的对象（Unity 假 null）和真 null
            if (view.Key.Equals(null))
            {
                // 记录到延迟解绑队列，遍历结束后清理
                if (null == _pendingUnbinds)
                    _pendingUnbinds = new List<object>(4);
                _pendingUnbinds.Add(view.Key);
                continue;
            }
            view.Value(_data);
        }
        _isCallingView = false;
        OldData = _data;
        // 处理遍历期间的延迟解绑
        if (null != _pendingUnbinds && _pendingUnbinds.Count > 0)
        {
            for (int i = 0; i < _pendingUnbinds.Count; i++)
                viewEvent.Remove(_pendingUnbinds[i]);
            _pendingUnbinds.Clear();
        }
        // 处理遍历期间的延迟绑定
        if (null != _pendingBinds && _pendingBinds.Count > 0)
        {
            foreach (var pendingBind in _pendingBinds)
            {
                viewEvent[pendingBind.Key] = pendingBind.Value;
                pendingBind.Value(_data);
            }
        }
    }

    /// <summary>
    /// 绑定视图事件：若已存在则覆盖，并立即执行一次回调
    /// </summary>
    /// <param name="obj">订阅者对象</param>
    /// <param name="action">回调</param>
    public void Bind(object obj, Action<T> action)
    {
        CleanDeadBindings();
        if (_isCallingView)
        {
            if (null == _pendingBinds)
                _pendingBinds = new Dictionary<object, Action<T>>(4);
            _pendingBinds[obj] = action;
        }
        else
        {
            viewEvent[obj] = action;
            if (!obj.Equals(null))
                action(_data);    
        }
        
    }

    /// <summary>
    /// 解绑指定对象的视图事件（CallView遍历期间延迟移除）
    /// </summary>
    /// <param name="obj">订阅者对象</param>
    public void UnBind(object obj)
    {
        if (_isCallingView)
        {
            if (null == _pendingUnbinds)
                _pendingUnbinds = new List<object>(4);
            _pendingUnbinds.Add(obj);
        }
        else
        {
            viewEvent.Remove(obj);
        }
    }

    /// <summary>
    /// 清理已销毁对象的绑定（非遍历期间直接移除）
    /// </summary>
    private void CleanDeadBindings()
    {
        //#if UNITY_EDITOR
        if (viewEvent.Count == 0)
            return;
        if (null == _pendingUnbinds)
            _pendingUnbinds = new List<object>(4);
        foreach (var kvp in viewEvent)
        {
            if (kvp.Key.Equals(null))
                _pendingUnbinds.Add(kvp.Key);
        }
        if (_pendingUnbinds.Count > 0)
        {
            //Log.Info($"有未解绑的空引用 {_pendingUnbinds.Count}");
            for (int i = 0; i < _pendingUnbinds.Count; i++)
                viewEvent.Remove(_pendingUnbinds[i]);
            _pendingUnbinds.Clear();
        }
        //#endif
    }

    /// <summary>
    /// 释放资源：清空事件并移除消息监听
    /// </summary>
    public void Dispose()
    {
        _pendingUnbinds?.Clear();
        viewEvent.Clear();
        if (onMsg != null)
        {
            Events.RemoveListener(msgCode, OnMsg, this);
        }
    }
}
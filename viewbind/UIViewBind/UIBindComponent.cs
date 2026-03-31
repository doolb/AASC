using System;
using UnityEngine;

/// <summary>
/// 泛型抽象基类，用于将 UI 组件与数据绑定（ViewModel）进行双向绑定。
/// 继承自 UIComponent，提供 Bind/UnBind 生命周期管理。
/// </summary>
/// <typeparam name="T">绑定数据的数据类型</typeparam>
public abstract class UIBindComponent<T> : UIBindComponentBase<UIViewBind<T>>
{
    /// <summary>
    /// 点击事件
    /// </summary>
    public Action<UIViewBind<T>> onClick;
    
    /// <summary>
    /// 获取当前绑定的数据。
    /// 若未绑定数据绑定器，则返回默认值。
    /// </summary>
    public T dataSource
    {
        get
        {
            if (dataBind != null)
                return dataBind._data;
            return default(T);
        }
    }

    /// <summary>
    /// 绑定项的索引，用于在列表或网格中标识当前项。
    /// </summary>
    [HideInInspector] public int Index, Row, Col;
    
    /// <summary>
    /// 执行绑定：将当前组件注册到数据绑定器，并订阅数据更新回调。
    /// </summary>
    protected override void Bind()
    {
        if (dataBind != null)
        {
            dataBind.Bind(this, OnUpdateBind);
            //Debug.Log($"Bind {GetType().Name} {dataBind.data.GetType().Name}");
        }
    }

    /// <summary>
    /// 执行解绑：将当前组件从数据绑定器注销。
    /// </summary>
    protected override void UnBind()
    {
        if (dataBind != null)
        {
            dataBind.UnBind(this);
            //Debug.Log($"UnBind {GetType().Name} {dataBind.data.GetType().Name}");
        }
    }

    /// <summary>
    /// 当绑定数据发生变更时，由绑定器回调此方法以更新 UI。
    /// 子类必须实现具体的 UI 更新逻辑。
    /// </summary>
    /// <param name="data">最新的绑定数据</param>
    protected abstract void OnUpdateBind(T data);
    
    /// <summary>
    /// 刷新视图：手动调用，用于在数据绑定器更新后立即刷新 UI。
    /// </summary>
    protected override void RefreshView()
    {
        base.RefreshView();
        if (dataBind != null)
            OnUpdateBind(dataBind._data);
    }

    /// <summary>
    /// 刷新视图：手动调用，用于在数据绑定器更新后立即刷新 UI。
    /// </summary>
    public void Refresh()
    {
        RefreshView();
    }

    /// <summary>
    /// 设置点击事件，传递当前绑定的数据
    /// </summary>
    /// <param name="onClick"></param>
    public void SetClick(Action<T> onClick)
    {
        this.onClick = bind =>
        {
            if (bind != null)
                onClick?.Invoke(bind._data);
        };
    }
}
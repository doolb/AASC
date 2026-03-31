using System;
using UnityEngine;

/// <summary>
/// 泛型抽象基类，用于将 UI 组件与数据绑定（ViewModel）进行双向绑定。
/// 继承自 UIComponent，提供 Bind/UnBind 生命周期管理。
/// </summary>
/// <typeparam name="T">绑定数据的数据类型</typeparam>
public abstract class UIBindListComponent<T> : UIBindComponentBase<UIViewBindList<T>>
{
    /// <summary>
    /// 点击事件
    /// </summary>
    protected Action<UIViewBind<T>> onClick;
    
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
    /// 设置绑定数据列表
    /// </summary>
    /// <param name="bindList"></param>
    public void SetBind(UIViewBindList<T> bindList)
    {
        DataBind = bindList;
        if (bindList == null)
        {
            OnUpdateBind(0, 0);
        }
    }

    /// <summary>
    /// 当绑定数据发生变更时，由绑定器回调此方法以更新 UI。
    /// 子类必须实现具体的 UI 更新逻辑。
    /// </summary>
    /// <param name="data">最新的绑定数据</param>
    protected abstract void OnUpdateBind(int count, int oldCount);

    /// <summary>
    /// 设置列表项的绑定数据
    /// </summary>
    /// <param name="go"></param>
    /// <param name="index"></param>
    protected void SetBind(GameObject go,  UIViewBind<T> data, int index)
    {
        var bindComponent = go.GetComponent<UIBindComponent<T>>();
        if (null != bindComponent)
        {
            bindComponent.Index = index;
            bindComponent.Row = 0;
            bindComponent.Col = 0;
            bindComponent.DataBind = data;
            bindComponent.onClick = OnClickData;
        }
    }
    
    protected void SetBind(GameObject go, UIViewBind<T> data, int row, int col)
    {
        var bindComponent = go.GetComponent<UIBindComponent<T>>();
        if (null != bindComponent)
        {
            bindComponent.Index = 0;
            bindComponent.Row = row;
            bindComponent.Col = col;
            bindComponent.DataBind = data;
            bindComponent.onClick = OnClickData;
        }
    }

    public virtual void OnClickData(UIViewBind<T> data)
    {
        this.onClick?.Invoke(data);
    }
}
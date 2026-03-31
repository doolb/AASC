using UnityEngine;
using System;

/// <summary>
/// 所有UI 基类
/// </summary>
public class UIComponent : MonoBehaviour
{
    /// <summary>
    /// 是否已唤醒标志
    /// </summary>
    protected bool __yesAwake = false;

    /// <summary>
    /// 延迟时间更新委托
    /// </summary>
    protected Action OnDelayTimeUpdate;

    /// <summary>
    /// UI组件
    /// </summary>
    protected UIGoTable gotable;

    /// <summary>
    /// 初始化方法
    /// </summary>
    protected virtual void Awake()
    {
        __yesAwake = true;
        // 如果设置了延迟时间更新方法，则添加监听
        if (OnDelayTimeUpdate != null)
        {
            // 这里需要实现事件监听，暂时留空
            // Events:GetInstance().AddListener(eMessageNames.SecondsUpdateMsg, OnDelaySecond, this);
        }
        // 获取UI节点
        GetUIGoTable();
    }
    /// <summary>
    /// 初始化绑定数据
    /// </summary>
    protected virtual void Start()
    {
        UIBindData();
    }
    
    #region UI节点获取(UIGoTable)
    private void GetUIGoTable()
    {
        gotable = GetComponent<UIGoTable>();
        gotable.OnBtnClicked = (btn, isOn) =>
        {
            UINodeClick(btn, isOn);
            // 按钮点击事件处理
            OnBtnClick(btn, isOn);
        };
        gotable?.CreateCsTable();
        InitUINode();
    }

    /// <summary>
    /// 初始调用一次UIGoTable节点设置
    /// </summary>
    /// <param name="refresh"></param>
    protected virtual void InitUINode()
    { 
    }

    /// <summary>
    /// 初始化UINode点击事件
    /// </summary>
    /// <param name="btn"></param>
    /// <param name="isOn"></param>
    protected virtual void UINodeClick(GameObject btn, bool isOn)
    {
        
    }
    /// <summary>
    /// 按钮点击事件处理
    /// </summary>
    /// <param name="btn">按钮预设</param>
    /// <param name="isOn">Toggle是否选中</param>
    protected virtual void OnBtnClick(GameObject btn, bool isOn)
    {

    }

    /// <summary>
    /// 设置绑定数据
    /// </summary>
    protected virtual void UIBindData()
    {

    }

    #endregion

    /// <summary>
    /// 延迟秒数回调
    /// </summary>
    protected virtual void OnDelaySecond()
    {
        if (__yesAwake && OnDelayTimeUpdate != null)
        {
            OnDelayTimeUpdate();
        }
    }

    /// <summary>
    /// 销毁时的处理
    /// </summary>
    protected virtual void OnDestroy()
    {
        // 移除事件监听
        if (OnDelayTimeUpdate != null)
        {
            // Events:GetInstance().RemoveListener(eMessageNames.SecondsUpdateMsg, OnDelaySecond, this);
        }

        // 调用子类的销毁方法
        OnDispose();
    }

    /// <summary>
    /// 自定义销毁方法
    /// </summary>
    protected virtual void OnDispose()
    {
        // 子类可以重写此方法实现自定义销毁逻辑
    }
}
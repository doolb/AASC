using UnityEngine;

/// <summary>
/// 简单列表绑定组件，使用 UIViewBindList 作为数据源
/// 通过 SetChildrenActiveNumber 管理子物体数量，自动将 UIViewBind 绑定到子组件的 UIBindComponent
/// </summary>
/// <typeparam name="T">绑定数据类型</typeparam>
public class UIBindSimpleList<T> : UIBindListComponent<T>
{
    /// <summary>
    /// 列表项容器，用于管理子物体数量
    /// </summary>
    public Transform ItemContainer;
    /// <summary>
    /// 列表变化回调
    /// </summary>
    /// <param name="value">>=0 为列表长度变化（值=当前长度），<0 为元素内容变化（~值=索引）</param>
    protected override void OnUpdateBind(int value, int oldValue)
    {
        if (value >= 0)
        {
            // 列表长度变化，调整子物体数量并绑定数据
            ItemContainer.SetChildrenActiveNumber(value);
            BindAllItems(value);
        }
        else
        {
            // 元素内容变化，单项已通过 UIViewBind 自动通知，无需额外处理
        }
    }

    /// <summary>
    /// 绑定数据到每个列表项
    /// </summary>
    private void BindAllItems(int count)
    {
        if (null == dataBind) return;

        for (int i = 0; i < count; i++)
        {
            var child = ItemContainer.GetChild(i);
            if (null == child) continue;
            
            SetBind(child.gameObject, dataBind[i], i);
        }
    }
}

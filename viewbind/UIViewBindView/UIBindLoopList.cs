using UnityEngine;
using ExtraFoundation.Components;

/// <summary>
/// 循环列表绑定组件，使用 UIViewBindList 作为数据源驱动 LoopListView
/// 列表项创建时自动将 UIViewBind 绑定到子组件的 UIBindComponent
/// </summary>
/// <typeparam name="T">绑定数据类型</typeparam>
public class UIBindLoopList<T> : UIBindListComponent<T>
{
    /// <summary>
    /// 循环列表组件
    /// </summary>
    public LoopListView _loopListView;
    
    /// <summary>
    /// 是否已初始化
    /// </summary>
    private bool _isInited;

    /// <summary>
    /// 列表变化回调
    /// </summary>
    /// <param name="value">>=0 为列表长度变化（值=当前长度），<0 为元素内容变化（~值=索引）</param>
    protected override void OnUpdateBind(int value, int oldValue)
    {
        if (null == _loopListView)
        {
            _loopListView = GetComponent<LoopListView>();
        }
        if (null == _loopListView) return;

        if (value >= 0)
        {
            // 列表长度变化
            if (!_isInited)
            {
                _isInited = true;
                _loopListView.InitListView(value, OnGetItemByIndex);
            }
            else
            {
                _loopListView.SetListItemCount(value, 0);
                _loopListView.RefreshAllShownItem();
            }
        }
        else
        {
            // 元素内容变化
            int index = ~value;
            _loopListView.RefreshItemByItemIndex(index);
        }
    }

    /// <summary>
    /// 列表项创建/刷新回调，自动将绑定数据传递给子组件
    /// </summary>
    private LoopListViewItem OnGetItemByIndex(LoopListView listView, int index)
    {
        if (null == dataBind || index < 0 || index >= dataBind.Count)
            return null;

        var item = listView.NewListViewItem(listView.GetItemPrefabName(0));
        if (null == item) return null;

        // 自动将 UIViewBind<T> 绑定到列表项上的 UIBindComponent<T>
        SetBind(item.gameObject, dataBind[index], index);

        return item;
    }
}

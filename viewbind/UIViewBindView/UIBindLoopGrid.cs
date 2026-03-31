using UnityEngine;
using ExtraFoundation.Components;

/// <summary>
/// 循环网格绑定组件，使用 UIViewBindList 作为数据源驱动 LoopGridView
/// 列表项创建时自动将 UIViewBind 绑定到子组件的 UIBindComponent
/// </summary>
/// <typeparam name="T">绑定数据类型</typeparam>
public class UIBindLoopGrid<T> : UIBindListComponent<T>
{
    /// <summary>
    /// 循环网格组件
    /// </summary>
    public LoopGridView _loopGridView;

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
        if (null == _loopGridView)
        {
            _loopGridView = GetComponent<LoopGridView>();
        }

        if (null == _loopGridView)
        {
            Log.Error("未找到 LoopGridView");
            return;
        }

        if (value >= 0)
        {
            // 列表长度变化
            if (!_isInited)
            {
                _isInited = true;
                _loopGridView.InitGridView(value, OnGetItemByRowColumn);
            }
            else
            {
                _loopGridView.SetListItemCount(value);
                _loopGridView.RefreshAllShownItem();
            }
        }
        else
        {
            // 元素内容变化
            int index = ~value;
            _loopGridView.RefreshItemByItemIndex(index);
        }
    }

    /// <summary>
    /// 网格项创建/刷新回调，自动将绑定数据传递给子组件
    /// </summary>
    private LoopGridViewItem OnGetItemByRowColumn(LoopGridView gridView, int itemIndex, int row, int column)
    {
        if (null == dataBind || itemIndex < 0 || itemIndex >= dataBind.Count)
            return null;

        var item = gridView.NewListViewItem(gridView.GetItemPrefabName(0));
        if (null == item) return null;

        // 自动将 UIViewBind<T> 绑定到网格项上的 UIBindComponent<T>
        SetBind(item.gameObject, dataBind[itemIndex], row, column);
        var bindComponent = item.GetComponent<UIBindComponent<T>>();
        if (null != bindComponent)
        {
            bindComponent.DataBind = dataBind[itemIndex];
        }

        return item;
    }
}

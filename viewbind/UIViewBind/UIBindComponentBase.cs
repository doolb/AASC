using UnityEngine;

public abstract class UIBindComponentBase<TViewBind> : UIItemBase where TViewBind : class
{
    // 当前绑定的数据绑定器
    protected TViewBind dataBind;

    /// <summary>
    /// Inspector面板上的绑定表达式文本
    /// </summary>
    public string BindTo;
    
    /// <summary>
    /// 获取或设置数据绑定器。
    /// 设置时会自动解绑旧绑定器并绑定新绑定器。
    /// </summary>
    public TViewBind DataBind
    {
        get
        {
            return dataBind;
        }
        set
        {
            // 避免重复绑定
            if (dataBind != value)
            {
                UnBind();       // 解绑旧数据
                dataBind = value;
                if (gameObject.activeInHierarchy)
                    Bind();         // 绑定新数据
            }
        }
    }

    /// <summary>
    /// 当组件启用时调用：自动绑定数据。
    /// </summary>
    protected virtual void OnEnable()
    {
        Bind();
    }

    /// <summary>
    /// 当组件禁用时调用：自动解绑数据。
    /// </summary>
    protected virtual void OnDisable()
    {
        UnBind();
    }

    /// <summary>
    /// 执行绑定：将当前组件注册到数据绑定器，并订阅数据更新回调。
    /// </summary>
    protected abstract void Bind();

    /// <summary>
    /// 执行解绑：将当前组件从数据绑定器注销。
    /// </summary>
    protected abstract void UnBind();

    /// <summary>
    /// 新参数：更新组件的显示内容。
    /// </summary>
    /// <param name="sid"></param>
    /// <param name="number"></param>
    /// <param name="needShowCount"></param>
    /// <param name="needShowName"></param>
    /// <param name="bagType"></param>
    /// <param name="needFormatNumber"></param>
    /// <param name="needIntNumber"></param>
    /// <param name="isGray"></param>
    public override void NewParam(long sid = 0, long number = 0, bool needShowCount = true, bool needShowName = false,
        ItemBagType bagType = ItemBagType.Item,
        bool needFormatNumber = false, bool needIntNumber = false, bool isGray = false)
    {
        DataBind = BaseParamData as TViewBind;
    }
}
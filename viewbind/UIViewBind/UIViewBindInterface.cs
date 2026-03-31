using System;
using Msg;

public interface UIViewBindAttr
{
    public void BindAttr(AttrType type, object obj, Action<AttrDescInfo> handler);
    public void UnBindAttr(AttrType type, object obj);
}

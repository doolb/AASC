"""Nonlinear curvature-field smoothing and contrast enhancement, no mesh edits."""
import math

def enhance_curvature(values,neighbors,rounds=2,change=.25,gain=.5,floor=4.):
    if not 0<=rounds<=10 or not all(math.isfinite(x) for x in (change,gain,floor)) or not 0<change<1 or not 0<=gain<=2 or floor<=0:
        raise ValueError('曲率保边增强参数无效')
    original=list(values);result=list(values)
    if any(not math.isfinite(v) or v<0 for v in original):raise ValueError('曲率必须为有限非负值')
    caps=[max([original[i]]+[original[j] for j in ns])*(1+gain) for i,ns in enumerate(neighbors)]
    for _ in range(rounds):
        updated=[]
        for i,ns in enumerate(neighbors):
            value=result[i];near=[];far=[]
            for j in ns:
                other=result[j];relative=abs(value-other)/max(value,other,floor)
                (near if relative<=change else far).append(other)
            smooth=.5*value+.5*(sum(near)/len(near) if near else value)
            sharpen=gain*(value-sum(far)/len(far)) if far else 0.
            updated.append(min(caps[i],max(0.,smooth+sharpen)))
        result=updated
    return result


def settings_filter(values,neighbors,settings):
    return enhance_curvature(values,neighbors,int(settings.get('boundary_curvature_rounds',2)),
        float(settings.get('boundary_curvature_gate',.25)),float(settings.get('boundary_curvature_gain',.5)),
        float(settings.get('boundary_curvature_floor',4)))

@pose idle {
 arm_l reset;
 arm_r reset;
 arm_l bend forward 35;
 arm_r bend forward 35;
 arm_l turn right 90;
 arm_r turn right 90;
 elbow_l bend forward 30;
 elbow_r bend forward 30;
 wrist_l reset;
 wrist_r reset;
 wrist_l turn left 90;
 wrist_r turn left 90;
 wrist_l bend forward 10;
 wrist_r bend forward 10;
}
@animation standing {
 0: idle;
 8: idle;
}
main {
 standing;
}

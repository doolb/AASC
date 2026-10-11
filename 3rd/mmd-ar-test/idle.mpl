@pose idle {
 arm_l reset;
 arm_r reset;
 arm_l bend forward 35;
 arm_r bend forward 35;
 elbow_l bend forward 10;
 elbow_r bend forward 10;
 wrist_l reset;
 wrist_r reset;
 wrist_l bend forward -10;
 wrist_r bend forward -10;
}
@animation standing {
 0: idle;
 8: idle;
}
main {
 standing;
}

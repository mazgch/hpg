# Vehicles (CAN)

The HPG solution can be easily fitted to the CAN bus of a vehicle to support the DR function of the ZED-F9R.

The GPIO4 and GPIO5 of the NINA-W106 can be used to connect a CAN transceiver such as a SN65HVD230. There a simple breakout board that you can attach using jumper wires such as the [CJMCU-230](https://de.aliexpress.com/item/32278648363.html)

An example implementation of a CAN test is part of this project [``CANBUS.h``](../software/CANBUS.h) but the CAN protocol and messages are propritary for every vehicle and brand. The community around Comma.ai has a published a project that contains CAN definition definition files. You can go to their [project on github](https://github.com/commaai/opendbc) to get some information of different vehicles and brands.

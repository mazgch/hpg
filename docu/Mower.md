# Lawn Mower

The HPG solution can be easily fitted to a lawn mower to test the performance. 

![Bosch lawn mower](Mower.jpg)

The scooters from BOSCH can be easily hacked to extract the Hall sensor signals that are used as a distance sensor by the ZED-F9R WT input. First you need to open the mower. Remove the green and black cover by releasing the 6 plastic latched from the bottom side. Release the 8 screws, 6 are easily accessible and two are hidden under the black botton with an arrow next to the red stop botton. Now the black cover can be removed. The Hall sensors signals can be tapped in on the Green, Purple and Gray wires on the two motor connectors. In addition Red is 5V and may be Black is GND and5 volts. The signal from the ahll sensor is 3.3Vand can directly be used. The three thicker wires are to drive the motor. 

![Bosch lawn mower](Mower_Hack.png)

To convert the Hall sensors signals to a ``UBX-ESF-MEAS`` a small Arduino MCU with at least 7 GPIOs is used. This code could be integrated with the main project but we don't have enough spare GPIOs on the hpg board and maybe it also better to avoid lareg delays in processing and sampling the signals. For details about standalone software project [wtBox](../software/wtBox/README.md). I used 1kOhm resistors to connect the wtBox to the Hall sensor wires, and also for the connection to the HPG board ``ZED RXI`` pin and ``GND`` pins.   

![Bosch lawn mower](Mower_WtBox.png)



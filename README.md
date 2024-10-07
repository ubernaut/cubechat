# DistCompNet

Basic Idea:

This framework would enable you to run a website which hosts a large compute job. (ex: large physics problem, train a neural network etc.) 

When clients connect to your website they will join the compute network and help work on the job. 

Basic Arch:

Root Workload Server

* Tracks overall job status
* waits for peers to join and dispatches job shards to them
* receives input from peers and updates job status
* promotes clients to Group Masters when network grows large enough


Client 

* connects to network
* joins group 
* retrieves job from Group master
* Computes job
* may need to communicate with peers to complete job
* returns job to group master






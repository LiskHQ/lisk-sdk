#!/bin/sh

if [ $1 == "--reset" ]; then
	echo "*** Clearing Everything ..."
	pm2 kill
	# Storing Lisk Directory
	LISK_PATH=$(pwd)

	cd ~/.lisk && rm -rf mainchain-node-* && rm -rf pos-sidechain-example-*

	# Going back to Lisk Directory
	cd $LISK_PATH
fi;

cd ../..
echo "*** Building lisk-sdk ..."
{
	yarn cache clean
	yarn && yarn build
} || {
	echo "***** Error building lisk-sdk *****"
	exit
}

echo "*** Building pos-mainchain-fast ..."
cd examples/interop/pos-mainchain-fast
{
	yarn cache clean
	yarn --registry https://npm.lisk.com && yarn build
} || {
	echo "***** Error building pos-mainchain-fast *****"
	exit
}
cd ..

echo "*** Building pos-sidechain-example-one ..."
cd pos-sidechain-example-one
{
	yarn cache clean
	yarn --registry https://npm.lisk.com && yarn build
} || {
 	echo "***** Error building pos-sidechain-example-one *****"
 	exit
 }
cd ..

echo "*** Building pos-sidechain-example-two ..."
cd pos-sidechain-example-two
{
	yarn cache clean
	yarn --registry https://npm.lisk.com && yarn build
} || {
	 	echo "***** Error building pos-sidechain-example-two *****"
   	exit
}
cd ..

cd pos-mainchain-fast
pm2 start config/mainchain_node_one.sh
pm2 start config/mainchain_node_two.sh
cd ..
pm2 start run_sidechains.json

echo "All nodes started ..."
